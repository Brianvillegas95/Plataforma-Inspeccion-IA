var Module = typeof Module !== "undefined" ? Module : {};
var ready = new Promise(function (a, b) {
	Module.onAbort = b;
	Module.onRuntimeInitialized = function () {
		var b = {
			scan: Module.cwrap("zbar_scan", "number", ["number", "number", "number", "number"]),
			set_config: Module.cwrap("zbar_set_config", "number", ["number", "number", "number", "number"]),
			get_results: Module.cwrap("zbar_get_results", "number", [])
		};
		a({
			raw: Module,
			zbar: b
		})
	}
});
var ZBar = function () {
	function a(a) {
		this.zbar = a
	}
	a.prototype.scan = function (a, c) {
		void 0 === c && (c = null);
		var b = this.zbar.raw,
		d = b._malloc(a.data.length);
		b.HEAPU8.set(a.data, d);
		var e = 0;
		c && (e = this.setConfig("ANY", "ENABLE", 0), e = this.setConfig(c, "ENABLE", 1));
		b = this.zbar.scan(d, a.width, a.height, e);
		b || (b = this.getResults());
		return b
	};
	a.prototype.getResults = function () {
		for (var a = this.zbar.raw, c = this.zbar.get_results(), b = new a.VectorSymbols, d = [], e = b.op_get(c, 0); e; e = b.op_get(c, ++i)) {
			var f = e.get_type_name(),
			h = e.get_data(),
			g = [];
			if (h)
				for (var k = 0, r = h.length; k < r; k++)
					g.push(String.fromCharCode(h[k]));
			d.push({
				typeName: f,
				data: g.join("")
			});
			var i = 0
		}
		return d
	};
	a.prototype.setConfig = function (a, c, b) {
		var d = this.zbar.raw;
		a = "string" === typeof a ? d.ZBAR_CFG[a] : a;
		c = "string" === typeof c ? d.ZBAR_CFG[c] : c;
		if (void 0 === a || void 0 === c)
			throw new Error("Invalid config");
		return this.zbar.set_config(0, a, c, b)
	};
	return a
}
();
(function () {
	ready.then(function (a) {
		return new ZBar(a)
	})
});
var zbar = (function (a, b, c) {
	function d(a) {
		if (e[a])
			return e[a].exports;
		var b = e[a] = {
			i: a,
			l: !1,
			exports: {}
		};
		c[a].call(b.exports, b, b.exports, d);
		b.l = !0;
		return b.exports
	}
	var e = {};
	d.m = c;
	d.c = e;
	d.d = function (a, b, c) {
		d.o(a, b) || Object.defineProperty(a, b, {
			configurable: !1,
			enumerable: !0,
			get: c
		})
	};
	d.n = function (a) {
		var b = a && a.__esModule ? function () {
			return a["default"]
		}
		 : function () {
			return a
		};
		d.d(b, "a", b);
		return b
	};
	d.o = function (a, b) {
		return Object.prototype.hasOwnProperty.call(a, b)
	};
	d.p = "";
	return d(d.s = 0)
})
([function (a, b, c) {
			function d(a, b) {
				if (!(a instanceof b))
					throw new TypeError("Cannot call a class as a function");
			}
			var e = function () {
				function a(b, c) {
					for (var e = 0; e < c.length; e++) {
						var d = c[e];
						d.enumerable = d.enumerable || !1;
						d.configurable = !0;
						"value" in d && (d.writable = !0);
						Object.defineProperty(b, d.key, d)
					}
				}
				return function (b, c, e) {
					c && a(b.prototype, c);
					e && a(b, e);
					return b
				}
			}
			(),
			f = function () {
				function a(b) {
					d(this, a);
					this.module = b
				}
				e(a, [{
							key: "scan",
							value: function (a, b) {
								void 0 === b && (b = null);
								var c = this.module.raw;
								a = c.HEAPU8.subarray(a.data);
								var e = c._malloc(a.byteLength);
								c.HEAPU8.set(a, e);
								var d = 0;
								b && (this.setConfig("ANY", "ENABLE", 0), d = this.setConfig(b, "ENABLE", 1));
								b = this.module.zbar.scan(e, a.width, a.height, d);
								c._free(e);
								b || (b = this.getResults());
								return b
							}
						}, {
							key: "getResults",
							value: function () {
								for (var a = [], b = this.module.zbar.get_results(); b; ) {
									for (var c = new(this.module.raw.VectorSymbols), e = 0, d = c.op_get(b, e); d; d = c.op_get(b, ++e)) {
										for (var h = d.get_type_name(), g = d.get_data(), k = "", r = 0; r < g.byteLength; r++)
											k += String.fromCharCode(g[r]);
										a.push({
											typeName: h,
											data: k
										})
									}
									b = d.get_next()
								}
								return a
							}
						}, {
							key: "setConfig",
							value: function (a, b, c) {
								var e = this.module.raw;
								a = "string" === typeof a ? e.ZBAR_SYMBOLOGY[a] : a;
								b = "string" === typeof b ? e.ZBAR_CONFIG[b] : b;
								if (void 0 === a || void 0 === b)
									throw new Error("Invalid config");
								return this.module.zbar.set_config(a, b, c)
							}
						}
					]);
				return a
			}
			();
			a.exports = new Promise(function (a, b) {
				ready.then(function (b) {
					a(new f(b))
				})
			})
		}
	]);