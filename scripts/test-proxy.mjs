import http from "http";
import https from "https";
import fs from "fs";
import path from "path";

function createStreamingProxy() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

      if (parsedUrl.pathname === "/proxy") {
        const targetUrl = parsedUrl.searchParams.get("url");
        if (!targetUrl) {
          res.writeHead(400);
          return res.end("Missing target url");
        }

        const client = targetUrl.startsWith("http://") ? http : https;
        const requestHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "*/*"
        };
        if (req.headers.range) {
          requestHeaders["Range"] = req.headers.range;
        }

        const remoteReq = client.get(targetUrl, { headers: requestHeaders }, (remoteRes) => {
          // Handle redirect
          if (remoteRes.statusCode >= 300 && remoteRes.statusCode < 400 && remoteRes.headers.location) {
            // Simple redirect handling
            client.get(remoteRes.headers.location, { headers: requestHeaders }, (redirectRes) => {
              pipeResponse(redirectRes, res);
            }).on("error", (err) => {
              res.writeHead(502);
              res.end(err.message);
            });
            return;
          }
          pipeResponse(remoteRes, res);
        });

        remoteReq.on("error", (err) => {
          res.writeHead(502);
          res.end(err.message);
        });
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    function pipeResponse(source, target) {
      const responseHeaders = {
        "Content-Type": "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*"
      };
      if (source.headers["content-range"]) {
        responseHeaders["Content-Range"] = source.headers["content-range"];
      }
      if (source.headers["content-length"]) {
        responseHeaders["Content-Length"] = source.headers["content-length"];
      }
      target.writeHead(source.statusCode, responseHeaders);
      source.pipe(target);
    }

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

const { server, port } = await createStreamingProxy();
console.log(`Test streaming server running on 127.0.0.1:${port}`);

// Test streaming Incompetech song through proxy
const testUrl = `http://127.0.0.1:${port}/proxy?url=` + encodeURIComponent("https://incompetech.com/music/royalty-free/mp3-royaltyfree/The%20Britons.mp3");

const res = await new Promise((resolve) => {
  http.get(testUrl, { headers: { Range: "bytes=0-1024" } }, resolve);
});

console.log("Status Code:", res.statusCode);
console.log("Content-Type:", res.headers["content-type"]);
console.log("Content-Range:", res.headers["content-range"]);
console.log("Accept-Ranges:", res.headers["accept-ranges"]);

let received = 0;
res.on("data", (chunk) => { received += chunk.length; });
res.on("end", () => {
  console.log("Received bytes:", received);
  server.close();
  if (res.statusCode === 206 && res.headers["content-type"] === "audio/mpeg" && received > 0) {
    console.log("✓ Streaming proxy test PASSED!");
  } else {
    console.error("✗ Test failed");
    process.exit(1);
  }
});
