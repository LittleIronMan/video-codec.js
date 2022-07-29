/// <reference path="api.ts" />
/// <reference path="typings/MediaStream.d.ts" />

class Camera implements IReader {
    _video: HTMLVideoElement = null;
    _canvas: HTMLCanvasElement = null;
    _context: CanvasRenderingContext2D = null;
    _buf: ArrayBuffer = null;
    _y: Uint8ClampedArray;
    _u: Uint8ClampedArray;
    _v: Uint8ClampedArray;
    _width: number;
    _height: number;
    _first_timestamp: number;
    _next_timestamp: number;
    _prev_frame_index: number;
    _fps: number;
    _sec_per_frame: number;

    open(args: any): Promise<VideoInfo> {
        return new Promise<VideoInfo>((resolve, reject) => {
            var video_constraints: any = true;
            var callback = (strm) => {
                this._fps = args['fps'] || 5;
                this._sec_per_frame = 1 / this._fps;
                this._first_timestamp = this._prev_frame_index = -1;
                this._video = document.createElement('video');
                this._video.srcObject = strm;
                this._video.play();
                this._video.addEventListener('loadedmetadata', (e) => {
                    var w = this._width = this._video.videoWidth;
                    var h = this._height = this._video.videoHeight;
                    this._canvas = document.createElement('canvas');
                    this._canvas.width = w;
                    this._canvas.height = h;
                    this._context = this._canvas.getContext('2d');
                    this._buf = new ArrayBuffer(w * h * 1.5);
                    this._y = new Uint8ClampedArray(this._buf, 0, w * h);
                    this._u = new Uint8ClampedArray(this._buf, w * h, w * h / 4);
                    this._v = new Uint8ClampedArray(this._buf, w * h * 1.25, w * h / 4);
                    resolve({
                        width: w,
                        height: h,
                        fps_num: this._fps,
                        fps_den: 1,
                    });
                });
            };
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                if (args['width'] && args['height']) {
                    video_constraints = {
                        width: args['width'],
                        height: args['height']
                    };
                }
                navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: video_constraints
                }).then(callback, reject);
            } else {
                navigator.getUserMedia = (navigator.getUserMedia ||
                                          navigator.webkitGetUserMedia ||
                                          navigator.mozGetUserMedia ||
                                          navigator.msGetUserMedia);
                if (args['width'] && args['height']) {
                    video_constraints = {
                        mandatory: {
                            minWidth: args['width'],
                            minHeight: args['height'],
                            maxWidth: args['width'],
                            maxHeight: args['height']
                        }
                    };
                }
                navigator.getUserMedia({
                    audio: false,
                    video: video_constraints,
                }, callback, reject);
            }
        });
    }
    read(): Promise<ReadEventArgs> {
        return new Promise<ReadEventArgs>((resolve, reject) => {
            var timestamp = this._video.currentTime;
            if (this._first_timestamp == -1) {
                this._first_timestamp = timestamp;
                this._next_timestamp = timestamp;
            }
            if (timestamp < this._next_timestamp) {
                window.setTimeout(() => {
                    this.read().then(resolve, reject);
                }, (this._next_timestamp - timestamp) * 1000);
                return;
            }
            var logic_frame_idx = Math.round((timestamp - this._first_timestamp) / this._sec_per_frame);
            if (logic_frame_idx <= this._prev_frame_index)
                logic_frame_idx = this._prev_frame_index + 1;
            this._prev_frame_index = logic_frame_idx;
            this._next_timestamp = (logic_frame_idx + 1) * this._sec_per_frame;

            var start = Date.now();
            this._context.drawImage(this._video,
                                    0, 0, this._width, this._height,
                                    0, 0, this._width, this._height);
            var img = this._context.getImageData(0, 0, this._width, this._height);
            var rgba = img.data;
            for (var y = 0, j = 0; y < img.height; y += 2) {
                var p = y * img.width;
                for (var x = 0; x < img.width; x += 2, ++j) {
                    var pp = p + x
                    var pw = pp + img.width;
                    var p0 = pp * 4;
                    var p1 = pw * 4;
                    var r0 = rgba[p0    ], g0 = rgba[p0 + 1], b0 = rgba[p0 + 2];
                    var r1 = rgba[p0 + 4], g1 = rgba[p0 + 5], b1 = rgba[p0 + 6];
                    var r2 = rgba[p1    ], g2 = rgba[p1 + 1], b2 = rgba[p1 + 2];
                    var r3 = rgba[p1 + 4], g3 = rgba[p1 + 5], b3 = rgba[p1 + 6];
                    this._y[pp    ] = Math.floor(0.257 * r0 + 0.504 * g0 + 0.098 * b0 + 16);
                    this._y[pp + 1] = Math.floor(0.257 * r1 + 0.504 * g1 + 0.098 * b1 + 16);
                    this._y[pw    ] = Math.floor(0.257 * r2 + 0.504 * g2 + 0.098 * b2 + 16);
                    this._y[pw + 1] = Math.floor(0.257 * r3 + 0.504 * g3 + 0.098 * b3 + 16);
                    this._u[j] = Math.floor(-0.148 * r0 - 0.291 * g0 + 0.439 * b0 + 128);
                    this._v[j] = Math.floor( 0.439 * r1 - 0.368 * g1 - 0.071 * b1 + 128);
                }
            }
            resolve({
                timestamp: timestamp,
                ended: false,
                width: this._width,
                height: this._height,
                data: this._buf,
                y: this._y,
                u: this._u,
                v: this._v,
                transferable: false,
            });
        });
    }
    close(): void {
    }
}
