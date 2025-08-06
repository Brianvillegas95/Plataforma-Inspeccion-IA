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