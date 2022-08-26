/// <reference path="renderer.ts" />

document.addEventListener("DOMContentLoaded", async () => {
  const decoderWorker = new Worker("compiled_x86/openh264_decoder.js");

  await new Promise<any>((resolve, reject) => {
    // Этап setup, на первый message(пустой) worker должен просто вернуть `{status: 0}`, если всё ок

    decoderWorker.onmessage = (ev) => {
      if (ev.data.status == 0) {
        resolve(ev.data);
      } else {
        reject(ev.data);
      }
    };

    setTimeout(() => {
      decoderWorker.postMessage({});
    }, 1000);
  });

  console.log(`--- Worker started successfully`);

  function decode(packet: Packet): Promise<VideoFrame> {
    return new Promise((resolve, reject) => {
      decoderWorker.onmessage = (ev) => {
        if (ev.data.status == 0) {
          resolve(ev.data);
        } else {
          reject(ev.data);
        }
      };
      decoderWorker.postMessage(packet, [packet.data]);
    });
  }

  const dst_renderer = new Renderer(<HTMLCanvasElement>document.getElementById('decoded'));
  dst_renderer.init({
    // TODO расхардкодить
    width: 1920,
    height: 1080,
    // не используются при декодировании
    fps_num: 30,
    fps_den: 1,
  })

  const videoUrl = "ws://localhost:8080/ws/video";
  const ws = new WebSocket(videoUrl);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("message", function onMessage({ data }: {data: ArrayBuffer}) {
    // https://github.com/samirkumardas/jmuxer/issues/40
    if (document.visibilityState == "hidden") {
      console.log("---- Skip video websocket sample, because tab is hidden");
      return;
    }

    if (data.byteLength == 6) {
      return;
    }

    console.log(`ws msg, size == ${data.byteLength}`);

    decode({data} as Packet).then(
      function afterDecode(frame) {
        console.log("success");

        if (frame.data) {
          dst_renderer.draw(frame);
        }
      },
      (e) => {
        console.log("failed: decode", e);
      }
    );
  });

  // const pingInterval = setInterval(() => ws.send("ping"), 30000);

  // ws.addEventListener("close", () => {
  //   clearInterval(pingInterval);
  // });

  ws.addEventListener("error", (e) => {
    console.log("Socket Error");
  });
});
