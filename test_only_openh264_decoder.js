var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var H264FrameType;
(function (H264FrameType) {
    H264FrameType[H264FrameType["Key"] = 1] = "Key";
    H264FrameType[H264FrameType["IDR"] = 1] = "IDR";
    H264FrameType[H264FrameType["I"] = 2] = "I";
    H264FrameType[H264FrameType["P"] = 3] = "P";
    H264FrameType[H264FrameType["B"] = 4] = "B";
    H264FrameType[H264FrameType["Unknown"] = 255] = "Unknown";
})(H264FrameType || (H264FrameType = {}));
/// <reference path="api.ts" />
class Renderer {
    constructor(canvas) {
        this._canvas = canvas;
    }
    init(info) {
        this._canvas.width = info.width;
        this._canvas.height = info.height;
        this._context = this._canvas.getContext('2d');
        var img = this._img = this._context.createImageData(info.width, info.height);
        var rgba = img.data;
        for (var y = 0; y < img.height; y += 2) {
            var p0 = y * img.width;
            var p1 = p0 + img.width;
            for (var x = 0; x < img.width; x += 2) {
                rgba[(p0 + x) * 4 + 3] =
                    rgba[(p0 + x) * 4 + 7] =
                        rgba[(p1 + x) * 4 + 3] =
                            rgba[(p1 + x) * 4 + 7] = 255;
            }
        }
    }
    draw(frame) {
        var start = Date.now();
        var img = this._img;
        var rgba = img.data;
        // console.log(`start convert yuv`);
        for (var y = 0; y < img.height; y += 2) {
            var p0 = y * img.width;
            var p1 = p0 + img.width;
            var p4 = p0 / 4;
            for (var x = 0; x < img.width; x += 2) {
                var y0 = 1.164 * (frame.y[p0 + x] - 16);
                var y1 = 1.164 * (frame.y[p0 + x + 1] - 16);
                var y2 = 1.164 * (frame.y[p1 + x] - 16);
                var y3 = 1.164 * (frame.y[p1 + x + 1] - 16);
                var u = frame.u[p4 + x / 2], v = frame.v[p4 + x / 2];
                var t0 = 1.596 * (v - 128);
                var t1 = -0.391 * (u - 128) - 0.813 * (v - 128);
                var t2 = 2.018 * (u - 128);
                var p2 = (p0 + x) * 4;
                var p3 = (p1 + x) * 4;
                rgba[p2] = y0 + t0;
                rgba[p2 + 1] = y0 + t1;
                rgba[p2 + 2] = y0 + t2;
                rgba[p2 + 4] = y1 + t0;
                rgba[p2 + 5] = y1 + t1;
                rgba[p2 + 6] = y1 + t2;
                rgba[p3] = y2 + t0;
                rgba[p3 + 1] = y2 + t1;
                rgba[p3 + 2] = y2 + t2;
                rgba[p3 + 4] = y3 + t0;
                rgba[p3 + 5] = y3 + t1;
                rgba[p3 + 6] = y3 + t2;
            }
        }
        // console.log(`end convert yuv`);
        this._context.putImageData(img, 0, 0);
        // console.log(`canvas context updated`);
    }
}
/// <reference path="renderer.ts" />
document.addEventListener("DOMContentLoaded", () => __awaiter(this, void 0, void 0, function* () {
    const decoderWorker = new Worker("compiled_x86/openh264_decoder.js");
    yield new Promise((resolve, reject) => {
        // Этап setup, на первый message(пустой) worker должен просто вернуть `{status: 0}`, если всё ок
        decoderWorker.onmessage = (ev) => {
            if (ev.data.status == 0) {
                resolve(ev.data);
            }
            else {
                reject(ev.data);
            }
        };
        setTimeout(() => {
            decoderWorker.postMessage({});
        }, 1000);
    });
    console.log(`--- Worker started successfully`);
    function decode(packet) {
        return new Promise((resolve, reject) => {
            decoderWorker.onmessage = (ev) => {
                if (ev.data.status == 0) {
                    resolve(ev.data);
                }
                else {
                    reject(ev.data);
                }
            };
            decoderWorker.postMessage(packet, [packet.data]);
        });
    }
    const dst_renderer = new Renderer(document.getElementById('decoded'));
    dst_renderer.init({
        // TODO расхардкодить
        width: 1920,
        height: 1080,
        // не используются при декодировании
        fps_num: 30,
        fps_den: 1,
    });
    const videoUrl = "ws://localhost:8080/ws/video";
    const ws = new WebSocket(videoUrl);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", function onMessage({ data }) {
        // https://github.com/samirkumardas/jmuxer/issues/40
        if (document.visibilityState == "hidden") {
            console.log("---- Skip video websocket sample, because tab is hidden");
            return;
        }
        if (data.byteLength == 6) {
            return;
        }
        console.log(`ws msg, size == ${data.byteLength}`);
        decode({ data }).then(function afterDecode(frame) {
            console.log("success");
            if (frame.data) {
                dst_renderer.draw(frame);
            }
        }, (e) => {
            console.log("failed: decode", e);
        });
    });
    // const pingInterval = setInterval(() => ws.send("ping"), 30000);
    // ws.addEventListener("close", () => {
    //   clearInterval(pingInterval);
    // });
    ws.addEventListener("error", (e) => {
        console.log("Socket Error");
    });
}));
