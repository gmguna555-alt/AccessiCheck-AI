import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 30000; // 30 seconds

// Private/reserved IP ranges — SSRF protection on the server side
function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;
  if (parts[0] === 127) return true; // loopback
  if (parts[0] === 10) return true; // private class A
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // private class B
  if (parts[0] === 192 && parts[1] === 168) return true; // private class C
  if (parts[0] === 169 && parts[1] === 254) return true; // link-local / cloud metadata
  if (parts[0] === 0) return true; // unspecified
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
  if (parts[0] >= 224) return true; // multicast / reserved
  return false;
}

function validateUrl(rawUrl: string): { valid: boolean; error?: string; url?: URL } {
  if (!rawUrl || !rawUrl.trim()) {
    return { valid: false, error: "No URL provided." };
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: "Invalid URL format." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, error: "Only HTTP and HTTPS URLs are allowed." };
  }

  const hostname = url.hostname.toLowerCase();

  const blockedHosts = ["localhost", "metadata.google.internal", "metadata", "0.0.0.0"];
  if (blockedHosts.includes(hostname)) {
    return { valid: false, error: "Access to this host is blocked." };
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    return { valid: false, error: "Local network domains are blocked." };
  }

  if (!hostname.includes(".")) {
    return { valid: false, error: "Internal hostnames are blocked." };
  }

  // Check if hostname is an IP address
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: `Access to IP address ${hostname} is blocked (private/reserved range).` };
    }
  }

  // Block IPv6 loopback/link-local
  if (hostname.includes(":")) {
    if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
      return { valid: false, error: "Access to this IPv6 address is blocked." };
    }
  }

  return { valid: true, url };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST requests are supported." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const targetUrl: string = body.url;

    const validation = validateUrl(targetUrl);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(validation.url!.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "AccessiCheckAI/1.0 (Accessibility Testing Tool)",
        },
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
        return new Response(
          JSON.stringify({ error: "The request timed out after 30 seconds. The website may be slow or unresponsive." }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to reach the website. The site may be down or blocking requests." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const status = response.status;
      let message: string;
      if (status === 403 || status === 401) {
        message = `The website blocked the request (HTTP ${status}). It may require authentication or is blocking automated access.`;
      } else if (status === 404) {
        message = "The page was not found (HTTP 404). Check that the URL is correct.";
      } else if (status >= 500) {
        message = `The website's server returned an error (HTTP ${status}). The site may be temporarily down.`;
      } else {
        message = `The website returned an error (HTTP ${status}).`;
      }
      return new Response(
        JSON.stringify({ error: message, httpStatus: status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml") && !contentType.includes("text/plain")) {
      return new Response(
        JSON.stringify({ error: `The URL returned ${contentType} content, not an HTML page. This tool can only audit HTML pages.` }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      return new Response(
        JSON.stringify({ error: "The page is too large to audit (over 5 MB)." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const html = await response.text();

    if (html.length > MAX_RESPONSE_SIZE) {
      return new Response(
        JSON.stringify({ error: "The page content exceeds the 5 MB size limit." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!html || html.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "The page returned no content. The site may require JavaScript to render content." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const finalUrl = response.url || validation.url!.toString();

    return new Response(
      JSON.stringify({ html, finalUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
// AccessiCheck AI - fetch-url edge function
