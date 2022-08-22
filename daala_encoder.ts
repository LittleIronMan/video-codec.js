/// <reference path="api.ts" />
/// <reference path="typings/emscripten.d.ts" />

declare function _daala_encode_create(info: number): number;
declare function _daala_encode_ctl(encoder: number, req: number, buf: number, size: number): number;
declare function _daala_info_create(width: number, height: number,
                                    aspect_num: number, aspect_den: number,
                                    timebase_num: number, timebase_den: number, keyframe_rate: number): number;
declare function _daala_comment_create(): number;
declare function _daala_encode_flush_header(encoder: number, daala_comment: number, ogg_packet: number): number;
declare function _daala_encode_img_in(encoder: number, img: number, duration: number, last_frame: number, input_frames_left_encoder_buffer: number): number;
declare function _daala_encode_packet_out(encoder: number, last: number, ogg_packet: number): number;
declare function _od_img_create(width: number, height: number): number;

class DaalaEncoder {
    worker: Worker;
    encoder: number;
    op: number;
    img_ptr: number;
    y: Uint8Array;
    u: Uint8Array;
    v: Uint8Array;
    flag_ptr: number;

    constructor(worker: Worker) {
        this.worker = worker;
        this.worker.onmessage = (e: MessageEvent) => {
            this._setup(e.data);
        };
    }

    _setup(cfg: any) {
        this.worker.onmessage = () => {};
        this.op = Module._malloc(4 * 8);
        var di = _daala_info_create(cfg.width, cfg.height, 1, 1, cfg.fps_num, cfg.fps_den,
                                    cfg.params.keyframe_rate || 1);
        var dc = _daala_comment_create();
        this.img_ptr = _od_img_create(cfg.width, cfg.height);
        this.y = Module.HEAPU8.subarray(Module.getValue(this.img_ptr, 'i32'),
                                        Module.getValue(this.img_ptr, 'i32') + cfg.width * cfg.height);
        this.u = Module.HEAPU8.subarray(Module.getValue(this.img_ptr + 4 * 5, 'i32'),
                                        Module.getValue(this.img_ptr + 4 * 5, 'i32') + cfg.width * cfg.height / 4);
        this.v = Module.HEAPU8.subarray(Module.getValue(this.img_ptr + 4 * 10, 'i32'),
                                        Module.getValue(this.img_ptr + 4 * 10, 'i32') + cfg.width * cfg.height / 4);
        this.encoder = _daala_encode_create(di);
        if (this.encoder == 0) {
            this.worker.postMessage(<IResult>{status: -1});
            return;
        }

        var value = Module._malloc(4);
        var int_cfg_map = {
            'quant': 4000,
            'complexity': 4002,
            'use_activity_masking': 4006,
            'qm': 4008,
            'mc_use_chroma': 4100,
            'mv_res_min': 4102,
            'mv_level_min': 4104,
            'mv_level_max': 4106,
            'mc_use_satd': 4108,
        };
        for (var key in int_cfg_map) {
            if (key in cfg.params) {
                Module.setValue(value, cfg.params[key], 'i32');
                _daala_encode_ctl(this.encoder, int_cfg_map[key], value, 4);
            }
        }
        Module._free(value);

        var packets = [];
        var bytes = 0;
        if (_daala_encode_flush_header(this.encoder, dc, this.op) <= 0) {
            this.worker.postMessage(<IResult>{status: -1});
            return;
        }
        packets.push(this._ogg_packet_to_arraybuffer(this.op));
        bytes += packets[0].byteLength;
        while (1) {
            var ret = _daala_encode_flush_header(this.encoder, dc, this.op);
            if (ret == 0)
                break;
            if (ret < 0) {
                this.worker.postMessage(<IResult>{status: -1});
                return;
            }
            packets.push(this._ogg_packet_to_arraybuffer(this.op));
            bytes += packets[packets.length - 1].byteLength;
        }
        this.worker.onmessage = (e: MessageEvent) => {
            this._encode(e.data);
        };
        var data = new ArrayBuffer(4 * (1 + packets.length) + bytes);
        var view32 = new Uint32Array(data, 0, 1 + packets.length);
        var view8 = new Uint8Array(data, (1 + packets.length) * 4);
        view32[0] = packets.length;
        for (var i = 0, off=0; i < packets.length; ++i) {
            view32[i + 1] = packets[i].byteLength;
            view8.set(new Uint8Array(packets[i]), off);
            off += packets[i].byteLength;
        }
        this.flag_ptr = Module._malloc(4);
        this.worker.postMessage(<Packet&IResult>{
            status: 0,
            data: data,
            frame_type: H264FrameType.Unknown
        }, [data]);
    }

    _encode(frame: VideoFrame) {
        this.y.set(new Uint8Array(frame.y.buffer, frame.y.byteOffset, frame.y.byteLength), 0);
        this.u.set(new Uint8Array(frame.u.buffer, frame.u.byteOffset, frame.u.byteLength), 0);
        this.v.set(new Uint8Array(frame.v.buffer, frame.v.byteOffset, frame.v.byteLength), 0);
        var ret = _daala_encode_img_in(this.encoder, this.img_ptr, 0, 0, this.flag_ptr);
        if (ret != 0) {
            this.worker.postMessage(<IResult>{status: -1});
            return;
        }
        var ret = _daala_encode_packet_out(this.encoder, 0, this.op);
        if (ret < 0) {
            this.worker.postMessage(<IResult>{status: -1});
            return;
        }
        if (ret > 0) {
            var pkt = this._ogg_packet_to_arraybuffer(this.op);
            if (_daala_encode_packet_out(this.encoder, 0, this.op) != 0) {
                // not supported
                this.worker.postMessage(<IResult>{status: -2});
                return;
            }
            this.worker.postMessage(<Packet&IResult>{
                status: 0,
                data: pkt,
                frame_type: H264FrameType.Unknown
            }, [pkt]);
        } else {
            // このルートを通る可能性ってある？
            this.worker.postMessage(<Packet&IResult>{
                status: 0,
                data: null,
                frame_type: H264FrameType.Unknown
            });
        }
    }

    _ogg_packet_to_arraybuffer(op: number): ArrayBuffer {
        var ptr = <number>Module.getValue(op, 'i32');
        var bytes = <number>Module.getValue(op + 4, 'i32');
        var b_o_s = <number>Module.getValue(op + 8, 'i32');
        var e_o_s = <number>Module.getValue(op + 12, 'i32');
        var buf = new ArrayBuffer(bytes + 1/*flags*/ + 8/*granulepos*/ + 8/*packetno*/);
        var view = new Uint8Array(buf);
        view.set(Module.HEAPU8.subarray(ptr, ptr + bytes), 0);
        view[bytes] = (b_o_s ? 1 : 0) | ((e_o_s ? 1 : 0) << 1);
        view.set(Module.HEAPU8.subarray(op + 16, op + 32), bytes + 1);
        return buf;
    }
}
new DaalaEncoder(this);
