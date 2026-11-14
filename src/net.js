/**
 * Network Transport & Local Audio Streaming Server for CEP
 * - Bypasses Chromium CORS restrictions and Same-Origin Policy.
 * - Streams MP3/audio with proper "audio/mpeg" headers and Range requests.
 * - Strips "Content-Disposition: attachment" so Chromium HTML5 <audio> can play without errors.
 */
(function (global) {
  "use strict";

  function getNodeModule(name) {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        try { return window.cep_node.require(name); } catch (_) {}
      }
      if (typeof require === "function") {
        try { return require(name); } catch (_) {}
      }
    }
    return null;
  }

  let serverPort = null;
  let localServer = null;

  function initStreamingServer() {
    const http = getNodeModule("http");
    const https = getNodeModule("https");
    const fs = getNodeModule("fs");
    const path = getNodeModule("path");

    if (!http || !fs) {
      console.warn("Node.js modules not available for local streaming server.");
      return;
    }

    try {
      localServer = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

        // Remote Audio Streaming Proxy
        if (parsedUrl.pathname === "/proxy") {
          const targetUrl = parsedUrl.searchParams.get("url");
          if (!targetUrl) {
            res.writeHead(400);
            return res.end("Missing target url parameter");
          }

          const client = targetUrl.startsWith("http://") ? http : https;
          const reqHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "*/*"
          };
          if (req.headers.range) {
            reqHeaders["Range"] = req.headers.range;
          }

          function requestStream(url) {
            client.get(url, { headers: reqHeaders }, (remoteRes) => {
              // Follow redirects (301, 302, 307)
              if (remoteRes.statusCode >= 300 && remoteRes.statusCode < 400 && remoteRes.headers.location) {
                return requestStream(remoteRes.headers.location);
              }

              const responseHeaders = {
                "Content-Type": "audio/mpeg",
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*"
              };
              if (remoteRes.headers["content-range"]) {
                responseHeaders["Content-Range"] = remoteRes.headers["content-range"];
              }
              if (remoteRes.headers["content-length"]) {
                responseHeaders["Content-Length"] = remoteRes.headers["content-length"];
              }

              res.writeHead(remoteRes.statusCode, responseHeaders);
              remoteRes.pipe(res);
            }).on("error", (err) => {
              console.error("Audio proxy upstream error:", err);
              if (!res.headersSent) res.writeHead(502);
              res.end(err.message);
            });
          }

          requestStream(targetUrl);
        }
        // Local File Streaming
        else if (parsedUrl.pathname === "/local") {
          let filePath = parsedUrl.searchParams.get("file");
          if (!filePath) {
            res.writeHead(400);
            return res.end("Missing file parameter");
          }

          filePath = filePath.replace(/^file:\/\/\/?/, "").replace(/\//g, "\\");
          if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end("File not found on disk");
          }

          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".ogg": "audio/ogg",
            ".aac": "audio/aac",
            ".m4a": "audio/mp4",
            ".flac": "audio/flac"
          };
          const contentType = mimeTypes[ext] || "audio/mpeg";

          const stat = fs.statSync(filePath);
          const totalSize = stat.size;
          const range = req.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
              "Content-Range": `bytes ${start}-${end}/${totalSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": chunkSize,
              "Content-Type": contentType,
              "Access-Control-Allow-Origin": "*"
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
          } else {
            res.writeHead(200, {
              "Content-Length": totalSize,
              "Content-Type": contentType,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*"
            });
            fs.createReadStream(filePath).pipe(res);
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      localServer.listen(0, "127.0.0.1", () => {
        serverPort = localServer.address().port;
        console.log(`[FreeRoyaltiesMusic] Local audio streaming server active on 127.0.0.1:${serverPort}`);
      });
    } catch (e) {
      console.error("Failed to start local streaming server:", e);
    }
  }

  // Initialize streaming server immediately
  initStreamingServer();

  function fetchWithNode(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
      const https = getNodeModule("https");
      const http = getNodeModule("http");
      if (!https || !http) {
        return reject(new Error("Node.js network modules unavailable."));
      }

      const client = urlStr.startsWith("http://") ? http : https;
      const headers = Object.assign(
        {
          "User-Agent": "FreeRoyaltiesMusic/1.0.0 (After Effects CEP; Windows NT)",
          Accept: "application/json, text/plain, */*"
        },
        options.headers || {}
      );

      const req = client.get(urlStr, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchWithNode(res.headers.location, options).then(resolve, reject);
        }

        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => raw,
            json: async () => JSON.parse(raw)
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(options.timeout || 15000, () => {
        req.destroy(new Error("Network request timed out."));
      });
    });
  }

  global.NetTransport = {
    getStreamUrl(targetUrl) {
      if (!serverPort || !targetUrl) return targetUrl;

      if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
        return `http://127.0.0.1:${serverPort}/proxy?url=${encodeURIComponent(targetUrl)}`;
      }

      if (targetUrl.startsWith("file://") || /^[a-zA-Z]:\\/.test(targetUrl)) {
        return `http://127.0.0.1:${serverPort}/local?file=${encodeURIComponent(targetUrl)}`;
      }

      return targetUrl;
    },

    async fetchJson(url, options = {}) {
      const https = getNodeModule("https");
      if (https) {
        try {
          const res = await fetchWithNode(url, options);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return await res.json();
        } catch (err) {
          console.warn("Node fetch failed, falling back to browser fetch:", err);
        }
      }

      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    }
  };
})(window);
