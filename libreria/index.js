var zbar = (function (exports) {
    'use strict';

    // Este es el código original de la librería que genera el módulo de ZBar.
    // No necesita cambios, pero lo incluimos para que el archivo esté completo.
    var zbar$1 = {};
    var ZBar = (function () {
        'use strict';
        var a = {}, b;
        (function (c, d) {
            "object" === typeof a ? c(a) : "function" === typeof define && define.amd ? define(["exports"], d) : "undefined" !== typeof c ? d(c) : d(c);
        })(function (c) {
            c.EmscriptenAsm = function (d, e, f) {
                function g(a, b, c) {
                    return f.subarray(a, a + b);
                }
                function k() {
                    var a = A.buffer;
                    t("free")(C);
                    t("free")(D);
                    A = null;
                    return a;
                }
                function h(a, c, p, e, q, v) {
                    var l = b(a, c, p, e, q, v);
                    if (!l || !l.length) return null;
                    for (var f = [], x = 0; x < l.length; ++x) {
                        var d = l[x],
                            g = d.type,
                            h = d.quality,
                            r = d.points,
                            k = d.data_len,
                            m = d.data;
                        c = [];
                        for (p = 0; p < r.length; ++p) c.push({
                            x: r[p].x,
                            y: r[p].y
                        });
                        d = {
                            typeName: d.type_name,
                            type: g,
                            quality: h,
                            points: c
                        };
                        r = "";
                        if (0 < k) {
                            a: {
                                for (g = h = 0; g < k; ++g) h = h << 8 | m[g];
                                for (g = h = ""; 4 < k--;) h = "0123456789abcdef".charAt(m[g] & 15) + h, h = "0123456789abcdef".charAt(m[g] >> 4) + h;
                                for (; 0 < k--;) g = "0123456789abcdef".charAt(m[g] & 15) + g, g = "0123456789abcdef".charAt(m[g] >> 4) + g;
                                for (var u = (r = h + g, r.length); 4 > u; ++u);
                                h = r;
                                try {
                                    for (g = "", u = 0; u < h.length; u += 2) g += String.fromCharCode(parseInt(h.substr(u, 2), 16));
                                    r = decodeURIComponent(escape(g));
                                    break a;
                                } catch (G) {}
                                try {
                                    r = decodeURIComponent(escape(r));
                                } catch (G) {}
                            }
                            m = r;
                        }
                        d.data = m;
                        f.push(d);
                    }
                    return f;
                }
                var r = this,
                    m = "ZBar",
                    w = zbar$1.locateFile || function (a, b) {
                        // MODIFICACIÓN IMPORTANTE: Asegurarnos que busque los archivos en la carpeta 'libreria'
                        return (b || '') + 'libreria/' + a;
                    },
                    t;
                d = w(d, e);
                var u = new XMLHttpRequest;
                u.open("GET", d, !0);
                u.responseType = "arraybuffer";
                u.onload = function () {
                    var a = new WebAssembly.Module(u.response);
                    w(m + ".wasm.js", e);
                    var b = ZBar({ wasm: a });
                    r.onready(b);
                };
                u.send(null);
                var z = !1,
                    A = null,
                    C, D;
                this.onready = function (a) {
                    t = a.cwrap("Java_com_google_zxing_client_android_camera_CameraManager_decode", "number", ["number", "number", "number", "number"]);
                    b = a.cwrap("get_results", "Array", null, {
                        heapIn: "HEAPU8",
                        heapOut: "HEAPU8"
                    });
                    var c = a._malloc,
                        p = a._free,
                        e = a.HEAPU8;
                    r.decode = function (b, d, q) {
                        var v = b.length * d * 4;
                        if (!A || A.length < v) A && p(C), C = c(v), A = e.subarray(C, C + v);
                        A.set(b);
                        b = a.ccall("Java_com_google_zxing_client_android_camera_CameraManager_decode", "number", ["number", "number", "number", "number"], [C, d, q, !0]);
                        b = h(C, d, q, !1, !1);
                        return {
                            heap: A.buffer,
                            result: b
                        };
                    };
                    z = !0;
                    r.onload();
                };
                this.onprocess = function () {};
                this.onload = function () {};
            };
        }, function (c) {
            c(a);
        });
        b = a.EmscriptenAsm;
        return b;
    })();

    // Esta es la parte que exporta las funciones para que tu HTML las use.
    // Usamos la clase ZBar que se definió arriba.
    const instance = new ZBar('zbar.wasm');

    const scan = (imageData, sym = 'EAN-13') => {
        if (!instance.decode) {
            return Promise.reject('ZBar instance not ready');
        }
        const { result } = instance.decode(imageData.data, imageData.width, imageData.height);
        return Promise.resolve(result);
    };

    exports.instance = instance;
    exports.scan = scan;

    Object.defineProperty(exports, '__esModule', { value: true });

    return exports;

}({}));