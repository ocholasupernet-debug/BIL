"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-helpers.js
var require_err_helpers = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-helpers.js"(exports2, module2) {
    "use strict";
    var isErrorLike = (err) => {
      return err && typeof err.message === "string";
    };
    var getErrorCause = (err) => {
      if (!err) return;
      const cause = err.cause;
      if (typeof cause === "function") {
        const causeResult = err.cause();
        return isErrorLike(causeResult) ? causeResult : void 0;
      } else {
        return isErrorLike(cause) ? cause : void 0;
      }
    };
    var _stackWithCauses = (err, seen) => {
      if (!isErrorLike(err)) return "";
      const stack = err.stack || "";
      if (seen.has(err)) {
        return stack + "\ncauses have become circular...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        return stack + "\ncaused by: " + _stackWithCauses(cause, seen);
      } else {
        return stack;
      }
    };
    var stackWithCauses = (err) => _stackWithCauses(err, /* @__PURE__ */ new Set());
    var _messageWithCauses = (err, seen, skip) => {
      if (!isErrorLike(err)) return "";
      const message = skip ? "" : err.message || "";
      if (seen.has(err)) {
        return message + ": ...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        const skipIfVErrorStyleCause = typeof err.cause === "function";
        return message + (skipIfVErrorStyleCause ? "" : ": ") + _messageWithCauses(cause, seen, skipIfVErrorStyleCause);
      } else {
        return message;
      }
    };
    var messageWithCauses = (err) => _messageWithCauses(err, /* @__PURE__ */ new Set());
    module2.exports = {
      isErrorLike,
      getErrorCause,
      stackWithCauses,
      messageWithCauses
    };
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-proto.js
var require_err_proto = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-proto.js"(exports2, module2) {
    "use strict";
    var seen = /* @__PURE__ */ Symbol("circular-ref-tag");
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-err-ref");
    var pinoErrProto = Object.create({}, {
      type: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      message: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      stack: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      aggregateErrors: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoErrProto, rawSymbol, {
      writable: true,
      value: {}
    });
    module2.exports = {
      pinoErrProto,
      pinoErrorSymbols: {
        seen,
        rawSymbol
      }
    };
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err.js
var require_err = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err.js"(exports2, module2) {
    "use strict";
    module2.exports = errSerializer;
    var { messageWithCauses, stackWithCauses, isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = messageWithCauses(err);
      _err.stack = stackWithCauses(err);
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errSerializer(err2));
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (key !== "cause" && !Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-with-cause.js
var require_err_with_cause = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-with-cause.js"(exports2, module2) {
    "use strict";
    module2.exports = errWithCauseSerializer;
    var { isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errWithCauseSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = err.message;
      _err.stack = err.stack;
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errWithCauseSerializer(err2));
      }
      if (isErrorLike(err.cause) && !Object.prototype.hasOwnProperty.call(err.cause, seen)) {
        _err.cause = errWithCauseSerializer(err.cause);
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (!Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errWithCauseSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/req.js
var require_req = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/req.js"(exports2, module2) {
    "use strict";
    module2.exports = {
      mapHttpRequest,
      reqSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-req-ref");
    var pinoReqProto = Object.create({}, {
      id: {
        enumerable: true,
        writable: true,
        value: ""
      },
      method: {
        enumerable: true,
        writable: true,
        value: ""
      },
      url: {
        enumerable: true,
        writable: true,
        value: ""
      },
      query: {
        enumerable: true,
        writable: true,
        value: ""
      },
      params: {
        enumerable: true,
        writable: true,
        value: ""
      },
      headers: {
        enumerable: true,
        writable: true,
        value: {}
      },
      remoteAddress: {
        enumerable: true,
        writable: true,
        value: ""
      },
      remotePort: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoReqProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function reqSerializer(req) {
      const connection = req.info || req.socket;
      const _req = Object.create(pinoReqProto);
      _req.id = typeof req.id === "function" ? req.id() : req.id || (req.info ? req.info.id : void 0);
      _req.method = req.method;
      if (req.originalUrl) {
        _req.url = req.originalUrl;
      } else {
        const path = req.path;
        _req.url = typeof path === "string" ? path : req.url ? req.url.path || req.url : void 0;
      }
      if (req.query) {
        _req.query = req.query;
      }
      if (req.params) {
        _req.params = req.params;
      }
      _req.headers = req.headers;
      _req.remoteAddress = connection && connection.remoteAddress;
      _req.remotePort = connection && connection.remotePort;
      _req.raw = req.raw || req;
      return _req;
    }
    function mapHttpRequest(req) {
      return {
        req: reqSerializer(req)
      };
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/res.js
var require_res = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/res.js"(exports2, module2) {
    "use strict";
    module2.exports = {
      mapHttpResponse,
      resSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-res-ref");
    var pinoResProto = Object.create({}, {
      statusCode: {
        enumerable: true,
        writable: true,
        value: 0
      },
      headers: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoResProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function resSerializer(res) {
      const _res = Object.create(pinoResProto);
      _res.statusCode = res.headersSent ? res.statusCode : null;
      _res.headers = res.getHeaders ? res.getHeaders() : res._headers;
      _res.raw = res;
      return _res;
    }
    function mapHttpResponse(res) {
      return {
        res: resSerializer(res)
      };
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/index.js
var require_pino_std_serializers = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/index.js"(exports2, module2) {
    "use strict";
    var errSerializer = require_err();
    var errWithCauseSerializer = require_err_with_cause();
    var reqSerializers = require_req();
    var resSerializers = require_res();
    module2.exports = {
      err: errSerializer,
      errWithCause: errWithCauseSerializer,
      mapHttpRequest: reqSerializers.mapHttpRequest,
      mapHttpResponse: resSerializers.mapHttpResponse,
      req: reqSerializers.reqSerializer,
      res: resSerializers.resSerializer,
      wrapErrorSerializer: function wrapErrorSerializer(customSerializer) {
        if (customSerializer === errSerializer) return customSerializer;
        return function wrapErrSerializer(err) {
          return customSerializer(errSerializer(err));
        };
      },
      wrapRequestSerializer: function wrapRequestSerializer(customSerializer) {
        if (customSerializer === reqSerializers.reqSerializer) return customSerializer;
        return function wrappedReqSerializer(req) {
          return customSerializer(reqSerializers.reqSerializer(req));
        };
      },
      wrapResponseSerializer: function wrapResponseSerializer(customSerializer) {
        if (customSerializer === resSerializers.resSerializer) return customSerializer;
        return function wrappedResSerializer(res) {
          return customSerializer(resSerializers.resSerializer(res));
        };
      }
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/caller.js
var require_caller = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/caller.js"(exports2, module2) {
    "use strict";
    function noOpPrepareStackTrace(_, stack) {
      return stack;
    }
    module2.exports = function getCallers() {
      const originalPrepare = Error.prepareStackTrace;
      Error.prepareStackTrace = noOpPrepareStackTrace;
      const stack = new Error().stack;
      Error.prepareStackTrace = originalPrepare;
      if (!Array.isArray(stack)) {
        return void 0;
      }
      const entries = stack.slice(2);
      const fileNames = [];
      for (const entry of entries) {
        if (!entry) {
          continue;
        }
        fileNames.push(entry.getFileName());
      }
      return fileNames;
    };
  }
});

// ../../node_modules/.pnpm/@pinojs+redact@0.4.0/node_modules/@pinojs/redact/index.js
var require_redact = __commonJS({
  "../../node_modules/.pnpm/@pinojs+redact@0.4.0/node_modules/@pinojs/redact/index.js"(exports2, module2) {
    "use strict";
    function deepClone(obj) {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      if (obj instanceof Date) {
        return new Date(obj.getTime());
      }
      if (obj instanceof Array) {
        const cloned = [];
        for (let i = 0; i < obj.length; i++) {
          cloned[i] = deepClone(obj[i]);
        }
        return cloned;
      }
      if (typeof obj === "object") {
        const cloned = Object.create(Object.getPrototypeOf(obj));
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
          }
        }
        return cloned;
      }
      return obj;
    }
    function parsePath(path) {
      const parts = [];
      let current = "";
      let inBrackets = false;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if (!inBrackets && char === ".") {
          if (current) {
            parts.push(current);
            current = "";
          }
        } else if (char === "[") {
          if (current) {
            parts.push(current);
            current = "";
          }
          inBrackets = true;
        } else if (char === "]" && inBrackets) {
          parts.push(current);
          current = "";
          inBrackets = false;
          inQuotes = false;
        } else if ((char === '"' || char === "'") && inBrackets) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          } else {
            current += char;
          }
        } else {
          current += char;
        }
      }
      if (current) {
        parts.push(current);
      }
      return parts;
    }
    function setValue(obj, parts, value) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = value;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              current[key] = value;
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          current[lastKey] = value;
        }
      }
      return true;
    }
    function removeKey(obj, parts) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = void 0;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              delete current[key];
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          delete current[lastKey];
        }
      }
      return true;
    }
    var PATH_NOT_FOUND = /* @__PURE__ */ Symbol("PATH_NOT_FOUND");
    function getValueIfExists(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return PATH_NOT_FOUND;
        }
        if (typeof current !== "object" || current === null) {
          return PATH_NOT_FOUND;
        }
        if (!(part in current)) {
          return PATH_NOT_FOUND;
        }
        current = current[part];
      }
      return current;
    }
    function getValue(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return void 0;
        }
        if (typeof current !== "object" || current === null) {
          return void 0;
        }
        current = current[part];
      }
      return current;
    }
    function redactPaths(obj, paths, censor, remove = false) {
      for (const path of paths) {
        const parts = parsePath(path);
        if (parts.includes("*")) {
          redactWildcardPath(obj, parts, censor, path, remove);
        } else {
          if (remove) {
            removeKey(obj, parts);
          } else {
            const value = getValueIfExists(obj, parts);
            if (value === PATH_NOT_FOUND) {
              continue;
            }
            const actualCensor = typeof censor === "function" ? censor(value, parts) : censor;
            setValue(obj, parts, actualCensor);
          }
        }
      }
    }
    function redactWildcardPath(obj, parts, censor, originalPath, remove = false) {
      const wildcardIndex = parts.indexOf("*");
      if (wildcardIndex === parts.length - 1) {
        const parentParts = parts.slice(0, -1);
        let current = obj;
        for (const part of parentParts) {
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
        }
        if (Array.isArray(current)) {
          if (remove) {
            for (let i = 0; i < current.length; i++) {
              current[i] = void 0;
            }
          } else {
            for (let i = 0; i < current.length; i++) {
              const indexPath = [...parentParts, i.toString()];
              const actualCensor = typeof censor === "function" ? censor(current[i], indexPath) : censor;
              current[i] = actualCensor;
            }
          }
        } else if (typeof current === "object" && current !== null) {
          if (remove) {
            const keysToDelete = [];
            for (const key in current) {
              if (Object.prototype.hasOwnProperty.call(current, key)) {
                keysToDelete.push(key);
              }
            }
            for (const key of keysToDelete) {
              delete current[key];
            }
          } else {
            for (const key in current) {
              const keyPath = [...parentParts, key];
              const actualCensor = typeof censor === "function" ? censor(current[key], keyPath) : censor;
              current[key] = actualCensor;
            }
          }
        }
      } else {
        redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove);
      }
    }
    function redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove = false) {
      const beforeWildcard = parts.slice(0, wildcardIndex);
      const afterWildcard = parts.slice(wildcardIndex + 1);
      const pathArray = [];
      function traverse(current, pathLength) {
        if (pathLength === beforeWildcard.length) {
          if (Array.isArray(current)) {
            for (let i = 0; i < current.length; i++) {
              pathArray[pathLength] = i.toString();
              traverse(current[i], pathLength + 1);
            }
          } else if (typeof current === "object" && current !== null) {
            for (const key in current) {
              pathArray[pathLength] = key;
              traverse(current[key], pathLength + 1);
            }
          }
        } else if (pathLength < beforeWildcard.length) {
          const nextKey = beforeWildcard[pathLength];
          if (current && typeof current === "object" && current !== null && nextKey in current) {
            pathArray[pathLength] = nextKey;
            traverse(current[nextKey], pathLength + 1);
          }
        } else {
          if (afterWildcard.includes("*")) {
            const wrappedCensor = typeof censor === "function" ? (value, path) => {
              const fullPath = [...pathArray.slice(0, pathLength), ...path];
              return censor(value, fullPath);
            } : censor;
            redactWildcardPath(current, afterWildcard, wrappedCensor, originalPath, remove);
          } else {
            if (remove) {
              removeKey(current, afterWildcard);
            } else {
              const actualCensor = typeof censor === "function" ? censor(getValue(current, afterWildcard), [...pathArray.slice(0, pathLength), ...afterWildcard]) : censor;
              setValue(current, afterWildcard, actualCensor);
            }
          }
        }
      }
      if (beforeWildcard.length === 0) {
        traverse(obj, 0);
      } else {
        let current = obj;
        for (let i = 0; i < beforeWildcard.length; i++) {
          const part = beforeWildcard[i];
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
          pathArray[i] = part;
        }
        if (current !== null && current !== void 0) {
          traverse(current, beforeWildcard.length);
        }
      }
    }
    function buildPathStructure(pathsToClone) {
      if (pathsToClone.length === 0) {
        return null;
      }
      const pathStructure = /* @__PURE__ */ new Map();
      for (const path of pathsToClone) {
        const parts = parsePath(path);
        let current = pathStructure;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!current.has(part)) {
            current.set(part, /* @__PURE__ */ new Map());
          }
          current = current.get(part);
        }
      }
      return pathStructure;
    }
    function selectiveClone(obj, pathStructure) {
      if (!pathStructure) {
        return obj;
      }
      function cloneSelectively(source, pathMap, depth = 0) {
        if (!pathMap || pathMap.size === 0) {
          return source;
        }
        if (source === null || typeof source !== "object") {
          return source;
        }
        if (source instanceof Date) {
          return new Date(source.getTime());
        }
        if (Array.isArray(source)) {
          const cloned2 = [];
          for (let i = 0; i < source.length; i++) {
            const indexStr = i.toString();
            if (pathMap.has(indexStr) || pathMap.has("*")) {
              cloned2[i] = cloneSelectively(source[i], pathMap.get(indexStr) || pathMap.get("*"));
            } else {
              cloned2[i] = source[i];
            }
          }
          return cloned2;
        }
        const cloned = Object.create(Object.getPrototypeOf(source));
        for (const key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            if (pathMap.has(key) || pathMap.has("*")) {
              cloned[key] = cloneSelectively(source[key], pathMap.get(key) || pathMap.get("*"));
            } else {
              cloned[key] = source[key];
            }
          }
        }
        return cloned;
      }
      return cloneSelectively(obj, pathStructure);
    }
    function validatePath(path) {
      if (typeof path !== "string") {
        throw new Error("Paths must be (non-empty) strings");
      }
      if (path === "") {
        throw new Error("Invalid redaction path ()");
      }
      if (path.includes("..")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      if (path.includes(",")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      let bracketCount = 0;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if ((char === '"' || char === "'") && bracketCount > 0) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          }
        } else if (char === "[" && !inQuotes) {
          bracketCount++;
        } else if (char === "]" && !inQuotes) {
          bracketCount--;
          if (bracketCount < 0) {
            throw new Error(`Invalid redaction path (${path})`);
          }
        }
      }
      if (bracketCount !== 0) {
        throw new Error(`Invalid redaction path (${path})`);
      }
    }
    function validatePaths(paths) {
      if (!Array.isArray(paths)) {
        throw new TypeError("paths must be an array");
      }
      for (const path of paths) {
        validatePath(path);
      }
    }
    function slowRedact(options = {}) {
      const {
        paths = [],
        censor = "[REDACTED]",
        serialize = JSON.stringify,
        strict = true,
        remove = false
      } = options;
      validatePaths(paths);
      const pathStructure = buildPathStructure(paths);
      return function redact(obj) {
        if (strict && (obj === null || typeof obj !== "object")) {
          if (obj === null || obj === void 0) {
            return serialize ? serialize(obj) : obj;
          }
          if (typeof obj !== "object") {
            return serialize ? serialize(obj) : obj;
          }
        }
        const cloned = selectiveClone(obj, pathStructure);
        const original = obj;
        let actualCensor = censor;
        if (typeof censor === "function") {
          actualCensor = censor;
        }
        redactPaths(cloned, paths, actualCensor, remove);
        if (serialize === false) {
          cloned.restore = function() {
            return deepClone(original);
          };
          return cloned;
        }
        if (typeof serialize === "function") {
          return serialize(cloned);
        }
        return JSON.stringify(cloned);
      };
    }
    module2.exports = slowRedact;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/symbols.js
var require_symbols = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/symbols.js"(exports2, module2) {
    "use strict";
    var setLevelSym = /* @__PURE__ */ Symbol("pino.setLevel");
    var getLevelSym = /* @__PURE__ */ Symbol("pino.getLevel");
    var levelValSym = /* @__PURE__ */ Symbol("pino.levelVal");
    var levelCompSym = /* @__PURE__ */ Symbol("pino.levelComp");
    var useLevelLabelsSym = /* @__PURE__ */ Symbol("pino.useLevelLabels");
    var useOnlyCustomLevelsSym = /* @__PURE__ */ Symbol("pino.useOnlyCustomLevels");
    var mixinSym = /* @__PURE__ */ Symbol("pino.mixin");
    var lsCacheSym = /* @__PURE__ */ Symbol("pino.lsCache");
    var chindingsSym = /* @__PURE__ */ Symbol("pino.chindings");
    var asJsonSym = /* @__PURE__ */ Symbol("pino.asJson");
    var writeSym = /* @__PURE__ */ Symbol("pino.write");
    var redactFmtSym = /* @__PURE__ */ Symbol("pino.redactFmt");
    var timeSym = /* @__PURE__ */ Symbol("pino.time");
    var timeSliceIndexSym = /* @__PURE__ */ Symbol("pino.timeSliceIndex");
    var streamSym = /* @__PURE__ */ Symbol("pino.stream");
    var stringifySym = /* @__PURE__ */ Symbol("pino.stringify");
    var stringifySafeSym = /* @__PURE__ */ Symbol("pino.stringifySafe");
    var stringifiersSym = /* @__PURE__ */ Symbol("pino.stringifiers");
    var endSym = /* @__PURE__ */ Symbol("pino.end");
    var formatOptsSym = /* @__PURE__ */ Symbol("pino.formatOpts");
    var messageKeySym = /* @__PURE__ */ Symbol("pino.messageKey");
    var errorKeySym = /* @__PURE__ */ Symbol("pino.errorKey");
    var nestedKeySym = /* @__PURE__ */ Symbol("pino.nestedKey");
    var nestedKeyStrSym = /* @__PURE__ */ Symbol("pino.nestedKeyStr");
    var mixinMergeStrategySym = /* @__PURE__ */ Symbol("pino.mixinMergeStrategy");
    var msgPrefixSym = /* @__PURE__ */ Symbol("pino.msgPrefix");
    var wildcardFirstSym = /* @__PURE__ */ Symbol("pino.wildcardFirst");
    var serializersSym = /* @__PURE__ */ Symbol.for("pino.serializers");
    var formattersSym = /* @__PURE__ */ Symbol.for("pino.formatters");
    var hooksSym = /* @__PURE__ */ Symbol.for("pino.hooks");
    var needsMetadataGsym = /* @__PURE__ */ Symbol.for("pino.metadata");
    module2.exports = {
      setLevelSym,
      getLevelSym,
      levelValSym,
      levelCompSym,
      useLevelLabelsSym,
      mixinSym,
      lsCacheSym,
      chindingsSym,
      asJsonSym,
      writeSym,
      serializersSym,
      redactFmtSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      wildcardFirstSym,
      needsMetadataGsym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/redaction.js
var require_redaction = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/redaction.js"(exports2, module2) {
    "use strict";
    var Redact = require_redact();
    var { redactFmtSym, wildcardFirstSym } = require_symbols();
    var rx = /[^.[\]]+|\[([^[\]]*?)\]/g;
    var CENSOR = "[Redacted]";
    var strict = false;
    function redaction(opts, serialize) {
      const { paths, censor, remove } = handle(opts);
      const shape = paths.reduce((o, str) => {
        rx.lastIndex = 0;
        const first = rx.exec(str);
        const next = rx.exec(str);
        let ns = first[1] !== void 0 ? first[1].replace(/^(?:"|'|`)(.*)(?:"|'|`)$/, "$1") : first[0];
        if (ns === "*") {
          ns = wildcardFirstSym;
        }
        if (next === null) {
          o[ns] = null;
          return o;
        }
        if (o[ns] === null) {
          return o;
        }
        const { index } = next;
        const nextPath = `${str.substr(index, str.length - 1)}`;
        o[ns] = o[ns] || [];
        if (ns !== wildcardFirstSym && o[ns].length === 0) {
          o[ns].push(...o[wildcardFirstSym] || []);
        }
        if (ns === wildcardFirstSym) {
          Object.keys(o).forEach(function(k) {
            if (o[k]) {
              o[k].push(nextPath);
            }
          });
        }
        o[ns].push(nextPath);
        return o;
      }, {});
      const result = {
        [redactFmtSym]: Redact({ paths, censor, serialize, strict, remove })
      };
      const topCensor = (...args) => {
        return typeof censor === "function" ? serialize(censor(...args)) : serialize(censor);
      };
      return [...Object.keys(shape), ...Object.getOwnPropertySymbols(shape)].reduce((o, k) => {
        if (shape[k] === null) {
          o[k] = (value) => topCensor(value, [k]);
        } else {
          const wrappedCensor = typeof censor === "function" ? (value, path) => {
            return censor(value, [k, ...path]);
          } : censor;
          o[k] = Redact({
            paths: shape[k],
            censor: wrappedCensor,
            serialize,
            strict,
            remove
          });
        }
        return o;
      }, result);
    }
    function handle(opts) {
      if (Array.isArray(opts)) {
        opts = { paths: opts, censor: CENSOR };
        return opts;
      }
      let { paths, censor = CENSOR, remove } = opts;
      if (Array.isArray(paths) === false) {
        throw Error("pino \u2013 redact must contain an array of strings");
      }
      if (remove === true) censor = void 0;
      return { paths, censor, remove };
    }
    module2.exports = redaction;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/time.js
var require_time = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/time.js"(exports2, module2) {
    "use strict";
    var nullTime = () => "";
    var epochTime = () => `,"time":${Date.now()}`;
    var unixTime = () => `,"time":${Math.round(Date.now() / 1e3)}`;
    var isoTime = () => `,"time":"${new Date(Date.now()).toISOString()}"`;
    var NS_PER_MS = 1000000n;
    var NS_PER_SEC = 1000000000n;
    var startWallTimeNs = BigInt(Date.now()) * NS_PER_MS;
    var startHrTime = process.hrtime.bigint();
    var isoTimeNano = () => {
      const elapsedNs = process.hrtime.bigint() - startHrTime;
      const currentTimeNs = startWallTimeNs + elapsedNs;
      const secondsSinceEpoch = currentTimeNs / NS_PER_SEC;
      const nanosWithinSecond = currentTimeNs % NS_PER_SEC;
      const msSinceEpoch = Number(secondsSinceEpoch * 1000n + nanosWithinSecond / 1000000n);
      const date = new Date(msSinceEpoch);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = date.getUTCDate().toString().padStart(2, "0");
      const hours = date.getUTCHours().toString().padStart(2, "0");
      const minutes = date.getUTCMinutes().toString().padStart(2, "0");
      const seconds = date.getUTCSeconds().toString().padStart(2, "0");
      return `,"time":"${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${nanosWithinSecond.toString().padStart(9, "0")}Z"`;
    };
    module2.exports = { nullTime, epochTime, unixTime, isoTime, isoTimeNano };
  }
});

// ../../node_modules/.pnpm/quick-format-unescaped@4.0.4/node_modules/quick-format-unescaped/index.js
var require_quick_format_unescaped = __commonJS({
  "../../node_modules/.pnpm/quick-format-unescaped@4.0.4/node_modules/quick-format-unescaped/index.js"(exports2, module2) {
    "use strict";
    function tryStringify(o) {
      try {
        return JSON.stringify(o);
      } catch (e) {
        return '"[Circular]"';
      }
    }
    module2.exports = format;
    function format(f, args, opts) {
      var ss = opts && opts.stringify || tryStringify;
      var offset = 1;
      if (typeof f === "object" && f !== null) {
        var len = args.length + offset;
        if (len === 1) return f;
        var objects = new Array(len);
        objects[0] = ss(f);
        for (var index = 1; index < len; index++) {
          objects[index] = ss(args[index]);
        }
        return objects.join(" ");
      }
      if (typeof f !== "string") {
        return f;
      }
      var argLen = args.length;
      if (argLen === 0) return f;
      var str = "";
      var a = 1 - offset;
      var lastPos = -1;
      var flen = f && f.length || 0;
      for (var i = 0; i < flen; ) {
        if (f.charCodeAt(i) === 37 && i + 1 < flen) {
          lastPos = lastPos > -1 ? lastPos : 0;
          switch (f.charCodeAt(i + 1)) {
            case 100:
            // 'd'
            case 102:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Number(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 105:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Math.floor(Number(args[a]));
              lastPos = i + 2;
              i++;
              break;
            case 79:
            // 'O'
            case 111:
            // 'o'
            case 106:
              if (a >= argLen)
                break;
              if (args[a] === void 0) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              var type = typeof args[a];
              if (type === "string") {
                str += "'" + args[a] + "'";
                lastPos = i + 2;
                i++;
                break;
              }
              if (type === "function") {
                str += args[a].name || "<anonymous>";
                lastPos = i + 2;
                i++;
                break;
              }
              str += ss(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 115:
              if (a >= argLen)
                break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += String(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 37:
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += "%";
              lastPos = i + 2;
              i++;
              a--;
              break;
          }
          ++a;
        }
        ++i;
      }
      if (lastPos === -1)
        return f;
      else if (lastPos < flen) {
        str += f.slice(lastPos);
      }
      return str;
    }
  }
});

// ../../node_modules/.pnpm/atomic-sleep@1.0.0/node_modules/atomic-sleep/index.js
var require_atomic_sleep = __commonJS({
  "../../node_modules/.pnpm/atomic-sleep@1.0.0/node_modules/atomic-sleep/index.js"(exports2, module2) {
    "use strict";
    if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
        Atomics.wait(nil, 0, 0, Number(ms));
      };
      const nil = new Int32Array(new SharedArrayBuffer(4));
      module2.exports = sleep;
    } else {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
        const target = Date.now() + Number(ms);
        while (target > Date.now()) {
        }
      };
      module2.exports = sleep;
    }
  }
});

// ../../node_modules/.pnpm/sonic-boom@4.2.1/node_modules/sonic-boom/index.js
var require_sonic_boom = __commonJS({
  "../../node_modules/.pnpm/sonic-boom@4.2.1/node_modules/sonic-boom/index.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var EventEmitter = require("events");
    var inherits = require("util").inherits;
    var path = require("path");
    var sleep = require_atomic_sleep();
    var assert = require("assert");
    var BUSY_WRITE_TIMEOUT = 100;
    var kEmptyBuffer = Buffer.allocUnsafe(0);
    var MAX_WRITE = 16 * 1024;
    var kContentModeBuffer = "buffer";
    var kContentModeUtf8 = "utf8";
    var [major, minor] = (process.versions.node || "0.0").split(".").map(Number);
    var kCopyBuffer = major >= 22 && minor >= 7;
    function openFile(file, sonic) {
      sonic._opening = true;
      sonic._writing = true;
      sonic._asyncDrainScheduled = false;
      function fileOpened(err, fd) {
        if (err) {
          sonic._reopening = false;
          sonic._writing = false;
          sonic._opening = false;
          if (sonic.sync) {
            process.nextTick(() => {
              if (sonic.listenerCount("error") > 0) {
                sonic.emit("error", err);
              }
            });
          } else {
            sonic.emit("error", err);
          }
          return;
        }
        const reopening = sonic._reopening;
        sonic.fd = fd;
        sonic.file = file;
        sonic._reopening = false;
        sonic._opening = false;
        sonic._writing = false;
        if (sonic.sync) {
          process.nextTick(() => sonic.emit("ready"));
        } else {
          sonic.emit("ready");
        }
        if (sonic.destroyed) {
          return;
        }
        if (!sonic._writing && sonic._len > sonic.minLength || sonic._flushPending) {
          sonic._actualWrite();
        } else if (reopening) {
          process.nextTick(() => sonic.emit("drain"));
        }
      }
      const flags = sonic.append ? "a" : "w";
      const mode = sonic.mode;
      if (sonic.sync) {
        try {
          if (sonic.mkdir) fs.mkdirSync(path.dirname(file), { recursive: true });
          const fd = fs.openSync(file, flags, mode);
          fileOpened(null, fd);
        } catch (err) {
          fileOpened(err);
          throw err;
        }
      } else if (sonic.mkdir) {
        fs.mkdir(path.dirname(file), { recursive: true }, (err) => {
          if (err) return fileOpened(err);
          fs.open(file, flags, mode, fileOpened);
        });
      } else {
        fs.open(file, flags, mode, fileOpened);
      }
    }
    function SonicBoom(opts) {
      if (!(this instanceof SonicBoom)) {
        return new SonicBoom(opts);
      }
      let { fd, dest, minLength, maxLength, maxWrite, periodicFlush, sync, append = true, mkdir, retryEAGAIN, fsync, contentMode, mode } = opts || {};
      fd = fd || dest;
      this._len = 0;
      this.fd = -1;
      this._bufs = [];
      this._lens = [];
      this._writing = false;
      this._ending = false;
      this._reopening = false;
      this._asyncDrainScheduled = false;
      this._flushPending = false;
      this._hwm = Math.max(minLength || 0, 16387);
      this.file = null;
      this.destroyed = false;
      this.minLength = minLength || 0;
      this.maxLength = maxLength || 0;
      this.maxWrite = maxWrite || MAX_WRITE;
      this._periodicFlush = periodicFlush || 0;
      this._periodicFlushTimer = void 0;
      this.sync = sync || false;
      this.writable = true;
      this._fsync = fsync || false;
      this.append = append || false;
      this.mode = mode;
      this.retryEAGAIN = retryEAGAIN || (() => true);
      this.mkdir = mkdir || false;
      let fsWriteSync;
      let fsWrite;
      if (contentMode === kContentModeBuffer) {
        this._writingBuf = kEmptyBuffer;
        this.write = writeBuffer;
        this.flush = flushBuffer;
        this.flushSync = flushBufferSync;
        this._actualWrite = actualWriteBuffer;
        fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf);
        fsWrite = () => fs.write(this.fd, this._writingBuf, this.release);
      } else if (contentMode === void 0 || contentMode === kContentModeUtf8) {
        this._writingBuf = "";
        this.write = write;
        this.flush = flush;
        this.flushSync = flushSync;
        this._actualWrite = actualWrite;
        fsWriteSync = () => {
          if (Buffer.isBuffer(this._writingBuf)) {
            return fs.writeSync(this.fd, this._writingBuf);
          }
          return fs.writeSync(this.fd, this._writingBuf, "utf8");
        };
        fsWrite = () => {
          if (Buffer.isBuffer(this._writingBuf)) {
            return fs.write(this.fd, this._writingBuf, this.release);
          }
          return fs.write(this.fd, this._writingBuf, "utf8", this.release);
        };
      } else {
        throw new Error(`SonicBoom supports "${kContentModeUtf8}" and "${kContentModeBuffer}", but passed ${contentMode}`);
      }
      if (typeof fd === "number") {
        this.fd = fd;
        process.nextTick(() => this.emit("ready"));
      } else if (typeof fd === "string") {
        openFile(fd, this);
      } else {
        throw new Error("SonicBoom supports only file descriptors and files");
      }
      if (this.minLength >= this.maxWrite) {
        throw new Error(`minLength should be smaller than maxWrite (${this.maxWrite})`);
      }
      this.release = (err, n) => {
        if (err) {
          if ((err.code === "EAGAIN" || err.code === "EBUSY") && this.retryEAGAIN(err, this._writingBuf.length, this._len - this._writingBuf.length)) {
            if (this.sync) {
              try {
                sleep(BUSY_WRITE_TIMEOUT);
                this.release(void 0, 0);
              } catch (err2) {
                this.release(err2);
              }
            } else {
              setTimeout(fsWrite, BUSY_WRITE_TIMEOUT);
            }
          } else {
            this._writing = false;
            this.emit("error", err);
          }
          return;
        }
        this.emit("write", n);
        const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n);
        this._len = releasedBufObj.len;
        this._writingBuf = releasedBufObj.writingBuf;
        if (this._writingBuf.length) {
          if (!this.sync) {
            fsWrite();
            return;
          }
          try {
            do {
              const n2 = fsWriteSync();
              const releasedBufObj2 = releaseWritingBuf(this._writingBuf, this._len, n2);
              this._len = releasedBufObj2.len;
              this._writingBuf = releasedBufObj2.writingBuf;
            } while (this._writingBuf.length);
          } catch (err2) {
            this.release(err2);
            return;
          }
        }
        if (this._fsync) {
          fs.fsyncSync(this.fd);
        }
        const len = this._len;
        if (this._reopening) {
          this._writing = false;
          this._reopening = false;
          this.reopen();
        } else if (len > this.minLength) {
          this._actualWrite();
        } else if (this._ending) {
          if (len > 0) {
            this._actualWrite();
          } else {
            this._writing = false;
            actualClose(this);
          }
        } else {
          this._writing = false;
          if (this.sync) {
            if (!this._asyncDrainScheduled) {
              this._asyncDrainScheduled = true;
              process.nextTick(emitDrain, this);
            }
          } else {
            this.emit("drain");
          }
        }
      };
      this.on("newListener", function(name) {
        if (name === "drain") {
          this._asyncDrainScheduled = false;
        }
      });
      if (this._periodicFlush !== 0) {
        this._periodicFlushTimer = setInterval(() => this.flush(null), this._periodicFlush);
        this._periodicFlushTimer.unref();
      }
    }
    function releaseWritingBuf(writingBuf, len, n) {
      if (typeof writingBuf === "string") {
        writingBuf = Buffer.from(writingBuf);
      }
      len = Math.max(len - n, 0);
      writingBuf = writingBuf.subarray(n);
      return { writingBuf, len };
    }
    function emitDrain(sonic) {
      const hasListeners = sonic.listenerCount("drain") > 0;
      if (!hasListeners) return;
      sonic._asyncDrainScheduled = false;
      sonic.emit("drain");
    }
    inherits(SonicBoom, EventEmitter);
    function mergeBuf(bufs, len) {
      if (bufs.length === 0) {
        return kEmptyBuffer;
      }
      if (bufs.length === 1) {
        return bufs[0];
      }
      return Buffer.concat(bufs, len);
    }
    function write(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      data = "" + data;
      const dataLen = Buffer.byteLength(data);
      const len = this._len + dataLen;
      const bufs = this._bufs;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || Buffer.byteLength(bufs[bufs.length - 1]) + dataLen > this.maxWrite) {
        bufs.push(data);
      } else {
        bufs[bufs.length - 1] += data;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function writeBuffer(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      const len = this._len + data.length;
      const bufs = this._bufs;
      const lens = this._lens;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || lens[lens.length - 1] + data.length > this.maxWrite) {
        bufs.push([data]);
        lens.push(data.length);
      } else {
        bufs[bufs.length - 1].push(data);
        lens[lens.length - 1] += data.length;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function callFlushCallbackOnDrain(cb) {
      this._flushPending = true;
      const onDrain = () => {
        if (!this._fsync) {
          try {
            fs.fsync(this.fd, (err) => {
              this._flushPending = false;
              cb(err);
            });
          } catch (err) {
            cb(err);
          }
        } else {
          this._flushPending = false;
          cb();
        }
        this.off("error", onError);
      };
      const onError = (err) => {
        this._flushPending = false;
        cb(err);
        this.off("drain", onDrain);
      };
      this.once("drain", onDrain);
      this.once("error", onError);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push("");
      }
      this._actualWrite();
    }
    function flushBuffer(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push([]);
        this._lens.push(0);
      }
      this._actualWrite();
    }
    SonicBoom.prototype.reopen = function(file) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.reopen(file);
        });
        return;
      }
      if (this._ending) {
        return;
      }
      if (!this.file) {
        throw new Error("Unable to reopen a file descriptor, you must pass a file to SonicBoom");
      }
      if (file) {
        this.file = file;
      }
      this._reopening = true;
      if (this._writing) {
        return;
      }
      const fd = this.fd;
      this.once("ready", () => {
        if (fd !== this.fd) {
          fs.close(fd, (err) => {
            if (err) {
              return this.emit("error", err);
            }
          });
        }
      });
      openFile(this.file, this);
    };
    SonicBoom.prototype.end = function() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.end();
        });
        return;
      }
      if (this._ending) {
        return;
      }
      this._ending = true;
      if (this._writing) {
        return;
      }
      if (this._len > 0 && this.fd >= 0) {
        this._actualWrite();
      } else {
        actualClose(this);
      }
    };
    function flushSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift(this._writingBuf);
        this._writingBuf = "";
      }
      let buf = "";
      while (this._bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = this._bufs[0];
        }
        try {
          const n = Buffer.isBuffer(buf) ? fs.writeSync(this.fd, buf) : fs.writeSync(this.fd, buf, "utf8");
          const releasedBufObj = releaseWritingBuf(buf, this._len, n);
          buf = releasedBufObj.writingBuf;
          this._len = releasedBufObj.len;
          if (buf.length <= 0) {
            this._bufs.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
      try {
        fs.fsyncSync(this.fd);
      } catch {
      }
    }
    function flushBufferSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift([this._writingBuf]);
        this._writingBuf = kEmptyBuffer;
      }
      let buf = kEmptyBuffer;
      while (this._bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = mergeBuf(this._bufs[0], this._lens[0]);
        }
        try {
          const n = fs.writeSync(this.fd, buf);
          buf = buf.subarray(n);
          this._len = Math.max(this._len - n, 0);
          if (buf.length <= 0) {
            this._bufs.shift();
            this._lens.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
    }
    SonicBoom.prototype.destroy = function() {
      if (this.destroyed) {
        return;
      }
      actualClose(this);
    };
    function actualWrite() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf.length ? this._writingBuf : this._bufs.shift() || "";
      if (this.sync) {
        try {
          const written = Buffer.isBuffer(this._writingBuf) ? fs.writeSync(this.fd, this._writingBuf) : fs.writeSync(this.fd, this._writingBuf, "utf8");
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        fs.write(this.fd, this._writingBuf, release);
      }
    }
    function actualWriteBuffer() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf.length ? this._writingBuf : mergeBuf(this._bufs.shift(), this._lens.shift());
      if (this.sync) {
        try {
          const written = fs.writeSync(this.fd, this._writingBuf);
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        if (kCopyBuffer) {
          this._writingBuf = Buffer.from(this._writingBuf);
        }
        fs.write(this.fd, this._writingBuf, release);
      }
    }
    function actualClose(sonic) {
      if (sonic.fd === -1) {
        sonic.once("ready", actualClose.bind(null, sonic));
        return;
      }
      if (sonic._periodicFlushTimer !== void 0) {
        clearInterval(sonic._periodicFlushTimer);
      }
      sonic.destroyed = true;
      sonic._bufs = [];
      sonic._lens = [];
      assert(typeof sonic.fd === "number", `sonic.fd must be a number, got ${typeof sonic.fd}`);
      try {
        fs.fsync(sonic.fd, closeWrapped);
      } catch {
      }
      function closeWrapped() {
        if (sonic.fd !== 1 && sonic.fd !== 2) {
          fs.close(sonic.fd, done);
        } else {
          done();
        }
      }
      function done(err) {
        if (err) {
          sonic.emit("error", err);
          return;
        }
        if (sonic._ending && !sonic._writing) {
          sonic.emit("finish");
        }
        sonic.emit("close");
      }
    }
    SonicBoom.SonicBoom = SonicBoom;
    SonicBoom.default = SonicBoom;
    module2.exports = SonicBoom;
  }
});

// ../../node_modules/.pnpm/on-exit-leak-free@2.1.2/node_modules/on-exit-leak-free/index.js
var require_on_exit_leak_free = __commonJS({
  "../../node_modules/.pnpm/on-exit-leak-free@2.1.2/node_modules/on-exit-leak-free/index.js"(exports2, module2) {
    "use strict";
    var refs = {
      exit: [],
      beforeExit: []
    };
    var functions = {
      exit: onExit,
      beforeExit: onBeforeExit
    };
    var registry;
    function ensureRegistry() {
      if (registry === void 0) {
        registry = new FinalizationRegistry(clear);
      }
    }
    function install(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.on(event, functions[event]);
    }
    function uninstall(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.removeListener(event, functions[event]);
      if (refs.exit.length === 0 && refs.beforeExit.length === 0) {
        registry = void 0;
      }
    }
    function onExit() {
      callRefs("exit");
    }
    function onBeforeExit() {
      callRefs("beforeExit");
    }
    function callRefs(event) {
      for (const ref of refs[event]) {
        const obj = ref.deref();
        const fn = ref.fn;
        if (obj !== void 0) {
          fn(obj, event);
        }
      }
      refs[event] = [];
    }
    function clear(ref) {
      for (const event of ["exit", "beforeExit"]) {
        const index = refs[event].indexOf(ref);
        refs[event].splice(index, index + 1);
        uninstall(event);
      }
    }
    function _register(event, obj, fn) {
      if (obj === void 0) {
        throw new Error("the object can't be undefined");
      }
      install(event);
      const ref = new WeakRef(obj);
      ref.fn = fn;
      ensureRegistry();
      registry.register(obj, ref);
      refs[event].push(ref);
    }
    function register(obj, fn) {
      _register("exit", obj, fn);
    }
    function registerBeforeExit(obj, fn) {
      _register("beforeExit", obj, fn);
    }
    function unregister(obj) {
      if (registry === void 0) {
        return;
      }
      registry.unregister(obj);
      for (const event of ["exit", "beforeExit"]) {
        refs[event] = refs[event].filter((ref) => {
          const _obj = ref.deref();
          return _obj && _obj !== obj;
        });
        uninstall(event);
      }
    }
    module2.exports = {
      register,
      registerBeforeExit,
      unregister
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/package.json
var require_package = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/package.json"(exports2, module2) {
    module2.exports = {
      name: "thread-stream",
      version: "3.1.0",
      description: "A streaming way to send data to a Node.js Worker Thread",
      main: "index.js",
      types: "index.d.ts",
      dependencies: {
        "real-require": "^0.2.0"
      },
      devDependencies: {
        "@types/node": "^20.1.0",
        "@types/tap": "^15.0.0",
        "@yao-pkg/pkg": "^5.11.5",
        desm: "^1.3.0",
        fastbench: "^1.0.1",
        husky: "^9.0.6",
        "pino-elasticsearch": "^8.0.0",
        "sonic-boom": "^4.0.1",
        standard: "^17.0.0",
        tap: "^16.2.0",
        "ts-node": "^10.8.0",
        typescript: "^5.3.2",
        "why-is-node-running": "^2.2.2"
      },
      scripts: {
        build: "tsc --noEmit",
        test: 'standard && npm run build && npm run transpile && tap "test/**/*.test.*js" && tap --ts test/*.test.*ts',
        "test:ci": "standard && npm run transpile && npm run test:ci:js && npm run test:ci:ts",
        "test:ci:js": 'tap --no-check-coverage --timeout=120 --coverage-report=lcovonly "test/**/*.test.*js"',
        "test:ci:ts": 'tap --ts --no-check-coverage --coverage-report=lcovonly "test/**/*.test.*ts"',
        "test:yarn": 'npm run transpile && tap "test/**/*.test.js" --no-check-coverage',
        transpile: "sh ./test/ts/transpile.sh",
        prepare: "husky install"
      },
      standard: {
        ignore: [
          "test/ts/**/*",
          "test/syntax-error.mjs"
        ]
      },
      repository: {
        type: "git",
        url: "git+https://github.com/mcollina/thread-stream.git"
      },
      keywords: [
        "worker",
        "thread",
        "threads",
        "stream"
      ],
      author: "Matteo Collina <hello@matteocollina.com>",
      license: "MIT",
      bugs: {
        url: "https://github.com/mcollina/thread-stream/issues"
      },
      homepage: "https://github.com/mcollina/thread-stream#readme"
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/wait.js
var require_wait = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/wait.js"(exports2, module2) {
    "use strict";
    var MAX_TIMEOUT = 1e3;
    function wait(state, index, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index);
      if (current === expected) {
        done(null, "ok");
        return;
      }
      let prior = current;
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            prior = current;
            current = Atomics.load(state, index);
            if (current === prior) {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            } else {
              if (current === expected) done(null, "ok");
              else done(null, "not-equal");
            }
          }, backoff);
        }
      };
      check(1);
    }
    function waitDiff(state, index, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index);
      if (current !== expected) {
        done(null, "ok");
        return;
      }
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            current = Atomics.load(state, index);
            if (current !== expected) {
              done(null, "ok");
            } else {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            }
          }, backoff);
        }
      };
      check(1);
    }
    module2.exports = { wait, waitDiff };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/indexes.js
var require_indexes = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/indexes.js"(exports2, module2) {
    "use strict";
    var WRITE_INDEX = 4;
    var READ_INDEX = 8;
    module2.exports = {
      WRITE_INDEX,
      READ_INDEX
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/index.js
var require_thread_stream = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/index.js"(exports2, module2) {
    "use strict";
    var { version } = require_package();
    var { EventEmitter } = require("events");
    var { Worker } = require("worker_threads");
    var { join } = require("path");
    var { pathToFileURL } = require("url");
    var { wait } = require_wait();
    var {
      WRITE_INDEX,
      READ_INDEX
    } = require_indexes();
    var buffer = require("buffer");
    var assert = require("assert");
    var kImpl = /* @__PURE__ */ Symbol("kImpl");
    var MAX_STRING = buffer.constants.MAX_STRING_LENGTH;
    var FakeWeakRef = class {
      constructor(value) {
        this._value = value;
      }
      deref() {
        return this._value;
      }
    };
    var FakeFinalizationRegistry = class {
      register() {
      }
      unregister() {
      }
    };
    var FinalizationRegistry2 = process.env.NODE_V8_COVERAGE ? FakeFinalizationRegistry : global.FinalizationRegistry || FakeFinalizationRegistry;
    var WeakRef2 = process.env.NODE_V8_COVERAGE ? FakeWeakRef : global.WeakRef || FakeWeakRef;
    var registry = new FinalizationRegistry2((worker) => {
      if (worker.exited) {
        return;
      }
      worker.terminate();
    });
    function createWorker(stream, opts) {
      const { filename, workerData } = opts;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      const toExecute = bundlerOverrides["thread-stream-worker"] || join(__dirname, "lib", "worker.js");
      const worker = new Worker(toExecute, {
        ...opts.workerOpts,
        trackUnmanagedFds: false,
        workerData: {
          filename: filename.indexOf("file://") === 0 ? filename : pathToFileURL(filename).href,
          dataBuf: stream[kImpl].dataBuf,
          stateBuf: stream[kImpl].stateBuf,
          workerData: {
            $context: {
              threadStreamVersion: version
            },
            ...workerData
          }
        }
      });
      worker.stream = new FakeWeakRef(stream);
      worker.on("message", onWorkerMessage);
      worker.on("exit", onWorkerExit);
      registry.register(stream, worker);
      return worker;
    }
    function drain(stream) {
      assert(!stream[kImpl].sync);
      if (stream[kImpl].needDrain) {
        stream[kImpl].needDrain = false;
        stream.emit("drain");
      }
    }
    function nextFlush(stream) {
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let leftover = stream[kImpl].data.length - writeIndex;
      if (leftover > 0) {
        if (stream[kImpl].buf.length === 0) {
          stream[kImpl].flushing = false;
          if (stream[kImpl].ending) {
            end(stream);
          } else if (stream[kImpl].needDrain) {
            process.nextTick(drain, stream);
          }
          return;
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, nextFlush.bind(null, stream));
        } else {
          stream.flush(() => {
            if (stream.destroyed) {
              return;
            }
            Atomics.store(stream[kImpl].state, READ_INDEX, 0);
            Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
            while (toWriteBytes > stream[kImpl].data.length) {
              leftover = leftover / 2;
              toWrite = stream[kImpl].buf.slice(0, leftover);
              toWriteBytes = Buffer.byteLength(toWrite);
            }
            stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
            write(stream, toWrite, nextFlush.bind(null, stream));
          });
        }
      } else if (leftover === 0) {
        if (writeIndex === 0 && stream[kImpl].buf.length === 0) {
          return;
        }
        stream.flush(() => {
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          nextFlush(stream);
        });
      } else {
        destroy(stream, new Error("overwritten"));
      }
    }
    function onWorkerMessage(msg) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        this.exited = true;
        this.terminate();
        return;
      }
      switch (msg.code) {
        case "READY":
          this.stream = new WeakRef2(stream);
          stream.flush(() => {
            stream[kImpl].ready = true;
            stream.emit("ready");
          });
          break;
        case "ERROR":
          destroy(stream, msg.err);
          break;
        case "EVENT":
          if (Array.isArray(msg.args)) {
            stream.emit(msg.name, ...msg.args);
          } else {
            stream.emit(msg.name, msg.args);
          }
          break;
        case "WARNING":
          process.emitWarning(msg.err);
          break;
        default:
          destroy(stream, new Error("this should not happen: " + msg.code));
      }
    }
    function onWorkerExit(code) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        return;
      }
      registry.unregister(stream);
      stream.worker.exited = true;
      stream.worker.off("exit", onWorkerExit);
      destroy(stream, code !== 0 ? new Error("the worker thread exited") : null);
    }
    var ThreadStream = class extends EventEmitter {
      constructor(opts = {}) {
        super();
        if (opts.bufferSize < 4) {
          throw new Error("bufferSize must at least fit a 4-byte utf-8 char");
        }
        this[kImpl] = {};
        this[kImpl].stateBuf = new SharedArrayBuffer(128);
        this[kImpl].state = new Int32Array(this[kImpl].stateBuf);
        this[kImpl].dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024);
        this[kImpl].data = Buffer.from(this[kImpl].dataBuf);
        this[kImpl].sync = opts.sync || false;
        this[kImpl].ending = false;
        this[kImpl].ended = false;
        this[kImpl].needDrain = false;
        this[kImpl].destroyed = false;
        this[kImpl].flushing = false;
        this[kImpl].ready = false;
        this[kImpl].finished = false;
        this[kImpl].errored = null;
        this[kImpl].closed = false;
        this[kImpl].buf = "";
        this.worker = createWorker(this, opts);
        this.on("message", (message, transferList) => {
          this.worker.postMessage(message, transferList);
        });
      }
      write(data) {
        if (this[kImpl].destroyed) {
          error(this, new Error("the worker has exited"));
          return false;
        }
        if (this[kImpl].ending) {
          error(this, new Error("the worker is ending"));
          return false;
        }
        if (this[kImpl].flushing && this[kImpl].buf.length + data.length >= MAX_STRING) {
          try {
            writeSync(this);
            this[kImpl].flushing = true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        this[kImpl].buf += data;
        if (this[kImpl].sync) {
          try {
            writeSync(this);
            return true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        if (!this[kImpl].flushing) {
          this[kImpl].flushing = true;
          setImmediate(nextFlush, this);
        }
        this[kImpl].needDrain = this[kImpl].data.length - this[kImpl].buf.length - Atomics.load(this[kImpl].state, WRITE_INDEX) <= 0;
        return !this[kImpl].needDrain;
      }
      end() {
        if (this[kImpl].destroyed) {
          return;
        }
        this[kImpl].ending = true;
        end(this);
      }
      flush(cb) {
        if (this[kImpl].destroyed) {
          if (typeof cb === "function") {
            process.nextTick(cb, new Error("the worker has exited"));
          }
          return;
        }
        const writeIndex = Atomics.load(this[kImpl].state, WRITE_INDEX);
        wait(this[kImpl].state, READ_INDEX, writeIndex, Infinity, (err, res) => {
          if (err) {
            destroy(this, err);
            process.nextTick(cb, err);
            return;
          }
          if (res === "not-equal") {
            this.flush(cb);
            return;
          }
          process.nextTick(cb);
        });
      }
      flushSync() {
        if (this[kImpl].destroyed) {
          return;
        }
        writeSync(this);
        flushSync(this);
      }
      unref() {
        this.worker.unref();
      }
      ref() {
        this.worker.ref();
      }
      get ready() {
        return this[kImpl].ready;
      }
      get destroyed() {
        return this[kImpl].destroyed;
      }
      get closed() {
        return this[kImpl].closed;
      }
      get writable() {
        return !this[kImpl].destroyed && !this[kImpl].ending;
      }
      get writableEnded() {
        return this[kImpl].ending;
      }
      get writableFinished() {
        return this[kImpl].finished;
      }
      get writableNeedDrain() {
        return this[kImpl].needDrain;
      }
      get writableObjectMode() {
        return false;
      }
      get writableErrored() {
        return this[kImpl].errored;
      }
    };
    function error(stream, err) {
      setImmediate(() => {
        stream.emit("error", err);
      });
    }
    function destroy(stream, err) {
      if (stream[kImpl].destroyed) {
        return;
      }
      stream[kImpl].destroyed = true;
      if (err) {
        stream[kImpl].errored = err;
        error(stream, err);
      }
      if (!stream.worker.exited) {
        stream.worker.terminate().catch(() => {
        }).then(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      } else {
        setImmediate(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      }
    }
    function write(stream, data, cb) {
      const current = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      const length = Buffer.byteLength(data);
      stream[kImpl].data.write(data, current);
      Atomics.store(stream[kImpl].state, WRITE_INDEX, current + length);
      Atomics.notify(stream[kImpl].state, WRITE_INDEX);
      cb();
      return true;
    }
    function end(stream) {
      if (stream[kImpl].ended || !stream[kImpl].ending || stream[kImpl].flushing) {
        return;
      }
      stream[kImpl].ended = true;
      try {
        stream.flushSync();
        let readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, -1);
        Atomics.notify(stream[kImpl].state, WRITE_INDEX);
        let spins = 0;
        while (readIndex !== -1) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
          readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
          if (readIndex === -2) {
            destroy(stream, new Error("end() failed"));
            return;
          }
          if (++spins === 10) {
            destroy(stream, new Error("end() took too long (10s)"));
            return;
          }
        }
        process.nextTick(() => {
          stream[kImpl].finished = true;
          stream.emit("finish");
        });
      } catch (err) {
        destroy(stream, err);
      }
    }
    function writeSync(stream) {
      const cb = () => {
        if (stream[kImpl].ending) {
          end(stream);
        } else if (stream[kImpl].needDrain) {
          process.nextTick(drain, stream);
        }
      };
      stream[kImpl].flushing = false;
      while (stream[kImpl].buf.length !== 0) {
        const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
        let leftover = stream[kImpl].data.length - writeIndex;
        if (leftover === 0) {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          continue;
        } else if (leftover < 0) {
          throw new Error("overwritten");
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        } else {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          while (toWriteBytes > stream[kImpl].buf.length) {
            leftover = leftover / 2;
            toWrite = stream[kImpl].buf.slice(0, leftover);
            toWriteBytes = Buffer.byteLength(toWrite);
          }
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        }
      }
    }
    function flushSync(stream) {
      if (stream[kImpl].flushing) {
        throw new Error("unable to flush while flushing");
      }
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let spins = 0;
      while (true) {
        const readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        if (readIndex === -2) {
          throw Error("_flushSync failed");
        }
        if (readIndex !== writeIndex) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
        } else {
          break;
        }
        if (++spins === 10) {
          throw new Error("_flushSync took too long (10s)");
        }
      }
    }
    module2.exports = ThreadStream;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/transport.js
var require_transport = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/transport.js"(exports2, module2) {
    "use strict";
    var { createRequire } = require("module");
    var getCallers = require_caller();
    var { join, isAbsolute, sep } = require("node:path");
    var sleep = require_atomic_sleep();
    var onExit = require_on_exit_leak_free();
    var ThreadStream = require_thread_stream();
    function setupOnExit(stream) {
      onExit.register(stream, autoEnd);
      onExit.registerBeforeExit(stream, flush);
      stream.on("close", function() {
        onExit.unregister(stream);
      });
    }
    function buildStream(filename, workerData, workerOpts, sync) {
      const stream = new ThreadStream({
        filename,
        workerData,
        workerOpts,
        sync
      });
      stream.on("ready", onReady);
      stream.on("close", function() {
        process.removeListener("exit", onExit2);
      });
      process.on("exit", onExit2);
      function onReady() {
        process.removeListener("exit", onExit2);
        stream.unref();
        if (workerOpts.autoEnd !== false) {
          setupOnExit(stream);
        }
      }
      function onExit2() {
        if (stream.closed) {
          return;
        }
        stream.flushSync();
        sleep(100);
        stream.end();
      }
      return stream;
    }
    function autoEnd(stream) {
      stream.ref();
      stream.flushSync();
      stream.end();
      stream.once("close", function() {
        stream.unref();
      });
    }
    function flush(stream) {
      stream.flushSync();
    }
    function transport(fullOptions) {
      const { pipeline, targets, levels, dedupe, worker = {}, caller = getCallers(), sync = false } = fullOptions;
      const options = {
        ...fullOptions.options
      };
      const callers = typeof caller === "string" ? [caller] : caller;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      let target = fullOptions.target;
      if (target && targets) {
        throw new Error("only one of target or targets can be specified");
      }
      if (targets) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.targets = targets.filter((dest) => dest.target).map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        });
        options.pipelines = targets.filter((dest) => dest.pipeline).map((dest) => {
          return dest.pipeline.map((t) => {
            return {
              ...t,
              level: dest.level,
              // duplicate the pipeline `level` property defined in the upper level
              target: fixTarget(t.target)
            };
          });
        });
      } else if (pipeline) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.pipelines = [pipeline.map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        })];
      }
      if (levels) {
        options.levels = levels;
      }
      if (dedupe) {
        options.dedupe = dedupe;
      }
      options.pinoWillSendConfig = true;
      return buildStream(fixTarget(target), options, worker, sync);
      function fixTarget(origin) {
        origin = bundlerOverrides[origin] || origin;
        if (isAbsolute(origin) || origin.indexOf("file://") === 0) {
          return origin;
        }
        if (origin === "pino/file") {
          return join(__dirname, "..", "file.js");
        }
        let fixTarget2;
        for (const filePath of callers) {
          try {
            const context = filePath === "node:repl" ? process.cwd() + sep : filePath;
            fixTarget2 = createRequire(context).resolve(origin);
            break;
          } catch (err) {
            continue;
          }
        }
        if (!fixTarget2) {
          throw new Error(`unable to determine transport target for "${origin}"`);
        }
        return fixTarget2;
      }
    }
    module2.exports = transport;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/tools.js
var require_tools = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/tools.js"(exports2, module2) {
    "use strict";
    var diagChan = require("node:diagnostics_channel");
    var format = require_quick_format_unescaped();
    var { mapHttpRequest, mapHttpResponse } = require_pino_std_serializers();
    var SonicBoom = require_sonic_boom();
    var onExit = require_on_exit_leak_free();
    var {
      lsCacheSym,
      chindingsSym,
      writeSym,
      serializersSym,
      formatOptsSym,
      endSym,
      stringifiersSym,
      stringifySym,
      stringifySafeSym,
      wildcardFirstSym,
      nestedKeySym,
      formattersSym,
      messageKeySym,
      errorKeySym,
      nestedKeyStrSym,
      msgPrefixSym
    } = require_symbols();
    var { isMainThread } = require("worker_threads");
    var transport = require_transport();
    var asJsonChan;
    if (typeof diagChan.tracingChannel === "function") {
      asJsonChan = diagChan.tracingChannel("pino_asJson");
    } else {
      asJsonChan = {
        hasSubscribers: false,
        traceSync(fn, store, thisArg, ...args) {
          return fn.call(thisArg, ...args);
        }
      };
    }
    function noop() {
    }
    function genLog(level, hook) {
      if (!hook) return LOG;
      return function hookWrappedLog(...args) {
        hook.call(this, args, LOG, level);
      };
      function LOG(o, ...n) {
        if (typeof o === "object") {
          let msg = o;
          if (o !== null) {
            if (o.method && o.headers && o.socket) {
              o = mapHttpRequest(o);
            } else if (typeof o.setHeader === "function") {
              o = mapHttpResponse(o);
            }
          }
          let formatParams;
          if (msg === null && n.length === 0) {
            formatParams = [null];
          } else {
            msg = n.shift();
            formatParams = n;
          }
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](o, format(msg, formatParams, this[formatOptsSym]), level);
        } else {
          let msg = o === void 0 ? n.shift() : o;
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](null, format(msg, n, this[formatOptsSym]), level);
        }
      }
    }
    function asString(str) {
      let result = "";
      let last = 0;
      let found = false;
      let point = 255;
      const l = str.length;
      if (l > 100) {
        return JSON.stringify(str);
      }
      for (var i = 0; i < l && point >= 32; i++) {
        point = str.charCodeAt(i);
        if (point === 34 || point === 92) {
          result += str.slice(last, i) + "\\";
          last = i;
          found = true;
        }
      }
      if (!found) {
        result = str;
      } else {
        result += str.slice(last);
      }
      return point < 32 ? JSON.stringify(str) : '"' + result + '"';
    }
    function asJson(obj, msg, num, time) {
      if (asJsonChan.hasSubscribers === false) {
        return _asJson.call(this, obj, msg, num, time);
      }
      const store = { instance: this, arguments };
      return asJsonChan.traceSync(_asJson, store, this, obj, msg, num, time);
    }
    function _asJson(obj, msg, num, time) {
      const stringify2 = this[stringifySym];
      const stringifySafe = this[stringifySafeSym];
      const stringifiers = this[stringifiersSym];
      const end = this[endSym];
      const chindings = this[chindingsSym];
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const messageKey = this[messageKeySym];
      const errorKey = this[errorKeySym];
      let data = this[lsCacheSym][num] + time;
      data = data + chindings;
      let value;
      if (formatters.log) {
        obj = formatters.log(obj);
      }
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      let propStr = "";
      for (const key in obj) {
        value = obj[key];
        if (Object.prototype.hasOwnProperty.call(obj, key) && value !== void 0) {
          if (serializers[key]) {
            value = serializers[key](value);
          } else if (key === errorKey && serializers.err) {
            value = serializers.err(value);
          }
          const stringifier = stringifiers[key] || wildcardStringifier;
          switch (typeof value) {
            case "undefined":
            case "function":
              continue;
            case "number":
              if (Number.isFinite(value) === false) {
                value = null;
              }
            // this case explicitly falls through to the next one
            case "boolean":
              if (stringifier) value = stringifier(value);
              break;
            case "string":
              value = (stringifier || asString)(value);
              break;
            default:
              value = (stringifier || stringify2)(value, stringifySafe);
          }
          if (value === void 0) continue;
          const strKey = asString(key);
          propStr += "," + strKey + ":" + value;
        }
      }
      let msgStr = "";
      if (msg !== void 0) {
        value = serializers[messageKey] ? serializers[messageKey](msg) : msg;
        const stringifier = stringifiers[messageKey] || wildcardStringifier;
        switch (typeof value) {
          case "function":
            break;
          case "number":
            if (Number.isFinite(value) === false) {
              value = null;
            }
          // this case explicitly falls through to the next one
          case "boolean":
            if (stringifier) value = stringifier(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          case "string":
            value = (stringifier || asString)(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          default:
            value = (stringifier || stringify2)(value, stringifySafe);
            msgStr = ',"' + messageKey + '":' + value;
        }
      }
      if (this[nestedKeySym] && propStr) {
        return data + this[nestedKeyStrSym] + propStr.slice(1) + "}" + msgStr + end;
      } else {
        return data + propStr + msgStr + end;
      }
    }
    function asChindings(instance, bindings) {
      let value;
      let data = instance[chindingsSym];
      const stringify2 = instance[stringifySym];
      const stringifySafe = instance[stringifySafeSym];
      const stringifiers = instance[stringifiersSym];
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      const serializers = instance[serializersSym];
      const formatter = instance[formattersSym].bindings;
      bindings = formatter(bindings);
      for (const key in bindings) {
        value = bindings[key];
        const valid = (key.length < 5 || key !== "level" && key !== "serializers" && key !== "formatters" && key !== "customLevels") && bindings.hasOwnProperty(key) && value !== void 0;
        if (valid === true) {
          value = serializers[key] ? serializers[key](value) : value;
          value = (stringifiers[key] || wildcardStringifier || stringify2)(value, stringifySafe);
          if (value === void 0) continue;
          data += ',"' + key + '":' + value;
        }
      }
      return data;
    }
    function hasBeenTampered(stream) {
      return stream.write !== stream.constructor.prototype.write;
    }
    function buildSafeSonicBoom(opts) {
      const stream = new SonicBoom(opts);
      stream.on("error", filterBrokenPipe);
      if (!opts.sync && isMainThread) {
        onExit.register(stream, autoEnd);
        stream.on("close", function() {
          onExit.unregister(stream);
        });
      }
      return stream;
      function filterBrokenPipe(err) {
        if (err.code === "EPIPE") {
          stream.write = noop;
          stream.end = noop;
          stream.flushSync = noop;
          stream.destroy = noop;
          return;
        }
        stream.removeListener("error", filterBrokenPipe);
        stream.emit("error", err);
      }
    }
    function autoEnd(stream, eventName) {
      if (stream.destroyed) {
        return;
      }
      if (eventName === "beforeExit") {
        stream.flush();
        stream.on("drain", function() {
          stream.end();
        });
      } else {
        stream.flushSync();
      }
    }
    function createArgsNormalizer(defaultOptions) {
      return function normalizeArgs(instance, caller, opts = {}, stream) {
        if (typeof opts === "string") {
          stream = buildSafeSonicBoom({ dest: opts });
          opts = {};
        } else if (typeof stream === "string") {
          if (opts && opts.transport) {
            throw Error("only one of option.transport or stream can be specified");
          }
          stream = buildSafeSonicBoom({ dest: stream });
        } else if (opts instanceof SonicBoom || opts.writable || opts._writableState) {
          stream = opts;
          opts = {};
        } else if (opts.transport) {
          if (opts.transport instanceof SonicBoom || opts.transport.writable || opts.transport._writableState) {
            throw Error("option.transport do not allow stream, please pass to option directly. e.g. pino(transport)");
          }
          if (opts.transport.targets && opts.transport.targets.length && opts.formatters && typeof opts.formatters.level === "function") {
            throw Error("option.transport.targets do not allow custom level formatters");
          }
          let customLevels;
          if (opts.customLevels) {
            customLevels = opts.useOnlyCustomLevels ? opts.customLevels : Object.assign({}, opts.levels, opts.customLevels);
          }
          stream = transport({ caller, ...opts.transport, levels: customLevels });
        }
        opts = Object.assign({}, defaultOptions, opts);
        opts.serializers = Object.assign({}, defaultOptions.serializers, opts.serializers);
        opts.formatters = Object.assign({}, defaultOptions.formatters, opts.formatters);
        if (opts.prettyPrint) {
          throw new Error("prettyPrint option is no longer supported, see the pino-pretty package (https://github.com/pinojs/pino-pretty)");
        }
        const { enabled, onChild } = opts;
        if (enabled === false) opts.level = "silent";
        if (!onChild) opts.onChild = noop;
        if (!stream) {
          if (!hasBeenTampered(process.stdout)) {
            stream = buildSafeSonicBoom({ fd: process.stdout.fd || 1 });
          } else {
            stream = process.stdout;
          }
        }
        return { opts, stream };
      };
    }
    function stringify(obj, stringifySafeFn) {
      try {
        return JSON.stringify(obj);
      } catch (_) {
        try {
          const stringify2 = stringifySafeFn || this[stringifySafeSym];
          return stringify2(obj);
        } catch (_2) {
          return '"[unable to serialize, circular reference is too complex to analyze]"';
        }
      }
    }
    function buildFormatters(level, bindings, log) {
      return {
        level,
        bindings,
        log
      };
    }
    function normalizeDestFileDescriptor(destination) {
      const fd = Number(destination);
      if (typeof destination === "string" && Number.isFinite(fd)) {
        return fd;
      }
      if (destination === void 0) {
        return 1;
      }
      return destination;
    }
    module2.exports = {
      noop,
      buildSafeSonicBoom,
      asChindings,
      asJson,
      genLog,
      createArgsNormalizer,
      stringify,
      buildFormatters,
      normalizeDestFileDescriptor
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/constants.js"(exports2, module2) {
    var DEFAULT_LEVELS = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60
    };
    var SORTING_ORDER = {
      ASC: "ASC",
      DESC: "DESC"
    };
    module2.exports = {
      DEFAULT_LEVELS,
      SORTING_ORDER
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/levels.js
var require_levels = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/levels.js"(exports2, module2) {
    "use strict";
    var {
      lsCacheSym,
      levelValSym,
      useOnlyCustomLevelsSym,
      streamSym,
      formattersSym,
      hooksSym,
      levelCompSym
    } = require_symbols();
    var { noop, genLog } = require_tools();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var levelMethods = {
      fatal: (hook) => {
        const logFatal = genLog(DEFAULT_LEVELS.fatal, hook);
        return function(...args) {
          const stream = this[streamSym];
          logFatal.call(this, ...args);
          if (typeof stream.flushSync === "function") {
            try {
              stream.flushSync();
            } catch (e) {
            }
          }
        };
      },
      error: (hook) => genLog(DEFAULT_LEVELS.error, hook),
      warn: (hook) => genLog(DEFAULT_LEVELS.warn, hook),
      info: (hook) => genLog(DEFAULT_LEVELS.info, hook),
      debug: (hook) => genLog(DEFAULT_LEVELS.debug, hook),
      trace: (hook) => genLog(DEFAULT_LEVELS.trace, hook)
    };
    var nums = Object.keys(DEFAULT_LEVELS).reduce((o, k) => {
      o[DEFAULT_LEVELS[k]] = k;
      return o;
    }, {});
    var initialLsCache = Object.keys(nums).reduce((o, k) => {
      o[k] = '{"level":' + Number(k);
      return o;
    }, {});
    function genLsCache(instance) {
      const formatter = instance[formattersSym].level;
      const { labels } = instance.levels;
      const cache = {};
      for (const label in labels) {
        const level = formatter(labels[label], Number(label));
        cache[label] = JSON.stringify(level).slice(0, -1);
      }
      instance[lsCacheSym] = cache;
      return instance;
    }
    function isStandardLevel(level, useOnlyCustomLevels) {
      if (useOnlyCustomLevels) {
        return false;
      }
      switch (level) {
        case "fatal":
        case "error":
        case "warn":
        case "info":
        case "debug":
        case "trace":
          return true;
        default:
          return false;
      }
    }
    function setLevel(level) {
      const { labels, values } = this.levels;
      if (typeof level === "number") {
        if (labels[level] === void 0) throw Error("unknown level value" + level);
        level = labels[level];
      }
      if (values[level] === void 0) throw Error("unknown level " + level);
      const preLevelVal = this[levelValSym];
      const levelVal = this[levelValSym] = values[level];
      const useOnlyCustomLevelsVal = this[useOnlyCustomLevelsSym];
      const levelComparison = this[levelCompSym];
      const hook = this[hooksSym].logMethod;
      for (const key in values) {
        if (levelComparison(values[key], levelVal) === false) {
          this[key] = noop;
          continue;
        }
        this[key] = isStandardLevel(key, useOnlyCustomLevelsVal) ? levelMethods[key](hook) : genLog(values[key], hook);
      }
      this.emit(
        "level-change",
        level,
        levelVal,
        labels[preLevelVal],
        preLevelVal,
        this
      );
    }
    function getLevel(level) {
      const { levels, levelVal } = this;
      return levels && levels.labels ? levels.labels[levelVal] : "";
    }
    function isLevelEnabled(logLevel) {
      const { values } = this.levels;
      const logLevelVal = values[logLevel];
      return logLevelVal !== void 0 && this[levelCompSym](logLevelVal, this[levelValSym]);
    }
    function compareLevel(direction, current, expected) {
      if (direction === SORTING_ORDER.DESC) {
        return current <= expected;
      }
      return current >= expected;
    }
    function genLevelComparison(levelComparison) {
      if (typeof levelComparison === "string") {
        return compareLevel.bind(null, levelComparison);
      }
      return levelComparison;
    }
    function mappings(customLevels = null, useOnlyCustomLevels = false) {
      const customNums = customLevels ? Object.keys(customLevels).reduce((o, k) => {
        o[customLevels[k]] = k;
        return o;
      }, {}) : null;
      const labels = Object.assign(
        Object.create(Object.prototype, { Infinity: { value: "silent" } }),
        useOnlyCustomLevels ? null : nums,
        customNums
      );
      const values = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      return { labels, values };
    }
    function assertDefaultLevelFound(defaultLevel, customLevels, useOnlyCustomLevels) {
      if (typeof defaultLevel === "number") {
        const values = [].concat(
          Object.keys(customLevels || {}).map((key) => customLevels[key]),
          useOnlyCustomLevels ? [] : Object.keys(nums).map((level) => +level),
          Infinity
        );
        if (!values.includes(defaultLevel)) {
          throw Error(`default level:${defaultLevel} must be included in custom levels`);
        }
        return;
      }
      const labels = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      if (!(defaultLevel in labels)) {
        throw Error(`default level:${defaultLevel} must be included in custom levels`);
      }
    }
    function assertNoLevelCollisions(levels, customLevels) {
      const { labels, values } = levels;
      for (const k in customLevels) {
        if (k in values) {
          throw Error("levels cannot be overridden");
        }
        if (customLevels[k] in labels) {
          throw Error("pre-existing level values cannot be used for new levels");
        }
      }
    }
    function assertLevelComparison(levelComparison) {
      if (typeof levelComparison === "function") {
        return;
      }
      if (typeof levelComparison === "string" && Object.values(SORTING_ORDER).includes(levelComparison)) {
        return;
      }
      throw new Error('Levels comparison should be one of "ASC", "DESC" or "function" type');
    }
    module2.exports = {
      initialLsCache,
      genLsCache,
      levelMethods,
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      assertNoLevelCollisions,
      assertDefaultLevelFound,
      genLevelComparison,
      assertLevelComparison
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/meta.js
var require_meta = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/meta.js"(exports2, module2) {
    "use strict";
    module2.exports = { version: "9.14.0" };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/proto.js
var require_proto = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/proto.js"(exports2, module2) {
    "use strict";
    var { EventEmitter } = require("node:events");
    var {
      lsCacheSym,
      levelValSym,
      setLevelSym,
      getLevelSym,
      chindingsSym,
      parsedChindingsSym,
      mixinSym,
      asJsonSym,
      writeSym,
      mixinMergeStrategySym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      serializersSym,
      formattersSym,
      errorKeySym,
      messageKeySym,
      useOnlyCustomLevelsSym,
      needsMetadataGsym,
      redactFmtSym,
      stringifySym,
      formatOptsSym,
      stringifiersSym,
      msgPrefixSym,
      hooksSym
    } = require_symbols();
    var {
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      initialLsCache,
      genLsCache,
      assertNoLevelCollisions
    } = require_levels();
    var {
      asChindings,
      asJson,
      buildFormatters,
      stringify,
      noop
    } = require_tools();
    var {
      version
    } = require_meta();
    var redaction = require_redaction();
    var constructor = class Pino {
    };
    var prototype = {
      constructor,
      child,
      bindings,
      setBindings,
      flush,
      isLevelEnabled,
      version,
      get level() {
        return this[getLevelSym]();
      },
      set level(lvl) {
        this[setLevelSym](lvl);
      },
      get levelVal() {
        return this[levelValSym];
      },
      set levelVal(n) {
        throw Error("levelVal is read-only");
      },
      get msgPrefix() {
        return this[msgPrefixSym];
      },
      get [Symbol.toStringTag]() {
        return "Pino";
      },
      [lsCacheSym]: initialLsCache,
      [writeSym]: write,
      [asJsonSym]: asJson,
      [getLevelSym]: getLevel,
      [setLevelSym]: setLevel
    };
    Object.setPrototypeOf(prototype, EventEmitter.prototype);
    module2.exports = function() {
      return Object.create(prototype);
    };
    var resetChildingsFormatter = (bindings2) => bindings2;
    function child(bindings2, options) {
      if (!bindings2) {
        throw Error("missing bindings for child Pino");
      }
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const instance = Object.create(this);
      if (options == null) {
        if (instance[formattersSym].bindings !== resetChildingsFormatter) {
          instance[formattersSym] = buildFormatters(
            formatters.level,
            resetChildingsFormatter,
            formatters.log
          );
        }
        instance[chindingsSym] = asChindings(instance, bindings2);
        instance[setLevelSym](this.level);
        if (this.onChild !== noop) {
          this.onChild(instance);
        }
        return instance;
      }
      if (options.hasOwnProperty("serializers") === true) {
        instance[serializersSym] = /* @__PURE__ */ Object.create(null);
        for (const k in serializers) {
          instance[serializersSym][k] = serializers[k];
        }
        const parentSymbols = Object.getOwnPropertySymbols(serializers);
        for (var i = 0; i < parentSymbols.length; i++) {
          const ks = parentSymbols[i];
          instance[serializersSym][ks] = serializers[ks];
        }
        for (const bk in options.serializers) {
          instance[serializersSym][bk] = options.serializers[bk];
        }
        const bindingsSymbols = Object.getOwnPropertySymbols(options.serializers);
        for (var bi = 0; bi < bindingsSymbols.length; bi++) {
          const bks = bindingsSymbols[bi];
          instance[serializersSym][bks] = options.serializers[bks];
        }
      } else instance[serializersSym] = serializers;
      if (options.hasOwnProperty("formatters")) {
        const { level, bindings: chindings, log } = options.formatters;
        instance[formattersSym] = buildFormatters(
          level || formatters.level,
          chindings || resetChildingsFormatter,
          log || formatters.log
        );
      } else {
        instance[formattersSym] = buildFormatters(
          formatters.level,
          resetChildingsFormatter,
          formatters.log
        );
      }
      if (options.hasOwnProperty("customLevels") === true) {
        assertNoLevelCollisions(this.levels, options.customLevels);
        instance.levels = mappings(options.customLevels, instance[useOnlyCustomLevelsSym]);
        genLsCache(instance);
      }
      if (typeof options.redact === "object" && options.redact !== null || Array.isArray(options.redact)) {
        instance.redact = options.redact;
        const stringifiers = redaction(instance.redact, stringify);
        const formatOpts = { stringify: stringifiers[redactFmtSym] };
        instance[stringifySym] = stringify;
        instance[stringifiersSym] = stringifiers;
        instance[formatOptsSym] = formatOpts;
      }
      if (typeof options.msgPrefix === "string") {
        instance[msgPrefixSym] = (this[msgPrefixSym] || "") + options.msgPrefix;
      }
      instance[chindingsSym] = asChindings(instance, bindings2);
      const childLevel = options.level || this.level;
      instance[setLevelSym](childLevel);
      this.onChild(instance);
      return instance;
    }
    function bindings() {
      const chindings = this[chindingsSym];
      const chindingsJson = `{${chindings.substr(1)}}`;
      const bindingsFromJson = JSON.parse(chindingsJson);
      delete bindingsFromJson.pid;
      delete bindingsFromJson.hostname;
      return bindingsFromJson;
    }
    function setBindings(newBindings) {
      const chindings = asChindings(this, newBindings);
      this[chindingsSym] = chindings;
      delete this[parsedChindingsSym];
    }
    function defaultMixinMergeStrategy(mergeObject, mixinObject) {
      return Object.assign(mixinObject, mergeObject);
    }
    function write(_obj, msg, num) {
      const t = this[timeSym]();
      const mixin = this[mixinSym];
      const errorKey = this[errorKeySym];
      const messageKey = this[messageKeySym];
      const mixinMergeStrategy = this[mixinMergeStrategySym] || defaultMixinMergeStrategy;
      let obj;
      const streamWriteHook = this[hooksSym].streamWrite;
      if (_obj === void 0 || _obj === null) {
        obj = {};
      } else if (_obj instanceof Error) {
        obj = { [errorKey]: _obj };
        if (msg === void 0) {
          msg = _obj.message;
        }
      } else {
        obj = _obj;
        if (msg === void 0 && _obj[messageKey] === void 0 && _obj[errorKey]) {
          msg = _obj[errorKey].message;
        }
      }
      if (mixin) {
        obj = mixinMergeStrategy(obj, mixin(obj, num, this));
      }
      const s = this[asJsonSym](obj, msg, num, t);
      const stream = this[streamSym];
      if (stream[needsMetadataGsym] === true) {
        stream.lastLevel = num;
        stream.lastObj = obj;
        stream.lastMsg = msg;
        stream.lastTime = t.slice(this[timeSliceIndexSym]);
        stream.lastLogger = this;
      }
      stream.write(streamWriteHook ? streamWriteHook(s) : s);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw Error("callback must be a function");
      }
      const stream = this[streamSym];
      if (typeof stream.flush === "function") {
        stream.flush(cb || noop);
      } else if (cb) cb();
    }
  }
});

// ../../node_modules/.pnpm/safe-stable-stringify@2.5.0/node_modules/safe-stable-stringify/index.js
var require_safe_stable_stringify = __commonJS({
  "../../node_modules/.pnpm/safe-stable-stringify@2.5.0/node_modules/safe-stable-stringify/index.js"(exports2, module2) {
    "use strict";
    var { hasOwnProperty } = Object.prototype;
    var stringify = configure();
    stringify.configure = configure;
    stringify.stringify = stringify;
    stringify.default = stringify;
    exports2.stringify = stringify;
    exports2.configure = configure;
    module2.exports = stringify;
    var strEscapeSequencesRegExp = /[\u0000-\u001f\u0022\u005c\ud800-\udfff]/;
    function strEscape(str) {
      if (str.length < 5e3 && !strEscapeSequencesRegExp.test(str)) {
        return `"${str}"`;
      }
      return JSON.stringify(str);
    }
    function sort(array, comparator) {
      if (array.length > 200 || comparator) {
        return array.sort(comparator);
      }
      for (let i = 1; i < array.length; i++) {
        const currentValue = array[i];
        let position = i;
        while (position !== 0 && array[position - 1] > currentValue) {
          array[position] = array[position - 1];
          position--;
        }
        array[position] = currentValue;
      }
      return array;
    }
    var typedArrayPrototypeGetSymbolToStringTag = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(
        Object.getPrototypeOf(
          new Int8Array()
        )
      ),
      Symbol.toStringTag
    ).get;
    function isTypedArrayWithEntries(value) {
      return typedArrayPrototypeGetSymbolToStringTag.call(value) !== void 0 && value.length !== 0;
    }
    function stringifyTypedArray(array, separator, maximumBreadth) {
      if (array.length < maximumBreadth) {
        maximumBreadth = array.length;
      }
      const whitespace = separator === "," ? "" : " ";
      let res = `"0":${whitespace}${array[0]}`;
      for (let i = 1; i < maximumBreadth; i++) {
        res += `${separator}"${i}":${whitespace}${array[i]}`;
      }
      return res;
    }
    function getCircularValueOption(options) {
      if (hasOwnProperty.call(options, "circularValue")) {
        const circularValue = options.circularValue;
        if (typeof circularValue === "string") {
          return `"${circularValue}"`;
        }
        if (circularValue == null) {
          return circularValue;
        }
        if (circularValue === Error || circularValue === TypeError) {
          return {
            toString() {
              throw new TypeError("Converting circular structure to JSON");
            }
          };
        }
        throw new TypeError('The "circularValue" argument must be of type string or the value null or undefined');
      }
      return '"[Circular]"';
    }
    function getDeterministicOption(options) {
      let value;
      if (hasOwnProperty.call(options, "deterministic")) {
        value = options.deterministic;
        if (typeof value !== "boolean" && typeof value !== "function") {
          throw new TypeError('The "deterministic" argument must be of type boolean or comparator function');
        }
      }
      return value === void 0 ? true : value;
    }
    function getBooleanOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "boolean") {
          throw new TypeError(`The "${key}" argument must be of type boolean`);
        }
      }
      return value === void 0 ? true : value;
    }
    function getPositiveIntegerOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "number") {
          throw new TypeError(`The "${key}" argument must be of type number`);
        }
        if (!Number.isInteger(value)) {
          throw new TypeError(`The "${key}" argument must be an integer`);
        }
        if (value < 1) {
          throw new RangeError(`The "${key}" argument must be >= 1`);
        }
      }
      return value === void 0 ? Infinity : value;
    }
    function getItemCount(number) {
      if (number === 1) {
        return "1 item";
      }
      return `${number} items`;
    }
    function getUniqueReplacerSet(replacerArray) {
      const replacerSet = /* @__PURE__ */ new Set();
      for (const value of replacerArray) {
        if (typeof value === "string" || typeof value === "number") {
          replacerSet.add(String(value));
        }
      }
      return replacerSet;
    }
    function getStrictOption(options) {
      if (hasOwnProperty.call(options, "strict")) {
        const value = options.strict;
        if (typeof value !== "boolean") {
          throw new TypeError('The "strict" argument must be of type boolean');
        }
        if (value) {
          return (value2) => {
            let message = `Object can not safely be stringified. Received type ${typeof value2}`;
            if (typeof value2 !== "function") message += ` (${value2.toString()})`;
            throw new Error(message);
          };
        }
      }
    }
    function configure(options) {
      options = { ...options };
      const fail = getStrictOption(options);
      if (fail) {
        if (options.bigint === void 0) {
          options.bigint = false;
        }
        if (!("circularValue" in options)) {
          options.circularValue = Error;
        }
      }
      const circularValue = getCircularValueOption(options);
      const bigint = getBooleanOption(options, "bigint");
      const deterministic = getDeterministicOption(options);
      const comparator = typeof deterministic === "function" ? deterministic : void 0;
      const maximumDepth = getPositiveIntegerOption(options, "maximumDepth");
      const maximumBreadth = getPositiveIntegerOption(options, "maximumBreadth");
      function stringifyFnReplacer(key, parent, stack, replacer, spacer, indentation) {
        let value = parent[key];
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        value = replacer.call(parent, key, value);
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            let join = ",";
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let whitespace = "";
            let separator = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (deterministic && !isTypedArrayWithEntries(value)) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyFnReplacer(key2, value, stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyArrayReplacer(key, value, stack, replacer, spacer, indentation) {
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            let res = "";
            let join = ",";
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            stack.push(value);
            let whitespace = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            let separator = "";
            for (const key2 of replacer) {
              const tmp = stringifyArrayReplacer(key2, value[key2], stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyIndent(key, value, stack, spacer, indentation) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifyIndent(key, value, stack, spacer, indentation);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              indentation += spacer;
              let res2 = `
${indentation}`;
              const join2 = `,
${indentation}`;
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyIndent(String(i), value[i], stack, spacer, indentation);
                res2 += tmp2 !== void 0 ? tmp2 : "null";
                res2 += join2;
              }
              const tmp = stringifyIndent(String(i), value[i], stack, spacer, indentation);
              res2 += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res2 += `${join2}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              res2 += `
${originalIndentation}`;
              stack.pop();
              return `[${res2}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            indentation += spacer;
            const join = `,
${indentation}`;
            let res = "";
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, join, maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = join;
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyIndent(key2, value[key2], stack, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}: ${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (separator !== "") {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifySimple(key, value, stack) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifySimple(key, value, stack);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            const hasLength = value.length !== void 0;
            if (hasLength && Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifySimple(String(i), value[i], stack);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += ",";
              }
              const tmp = stringifySimple(String(i), value[i], stack);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `,"... ${getItemCount(removedKeys)} not stringified"`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (hasLength && isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, ",", maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = ",";
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifySimple(key2, value[key2], stack);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${tmp}`;
                separator = ",";
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringify2(value, replacer, space) {
        if (arguments.length > 1) {
          let spacer = "";
          if (typeof space === "number") {
            spacer = " ".repeat(Math.min(space, 10));
          } else if (typeof space === "string") {
            spacer = space.slice(0, 10);
          }
          if (replacer != null) {
            if (typeof replacer === "function") {
              return stringifyFnReplacer("", { "": value }, [], replacer, spacer, "");
            }
            if (Array.isArray(replacer)) {
              return stringifyArrayReplacer("", value, [], getUniqueReplacerSet(replacer), spacer, "");
            }
          }
          if (spacer.length !== 0) {
            return stringifyIndent("", value, [], spacer, "");
          }
        }
        return stringifySimple("", value, []);
      }
      return stringify2;
    }
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/multistream.js
var require_multistream = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/multistream.js"(exports2, module2) {
    "use strict";
    var metadata = /* @__PURE__ */ Symbol.for("pino.metadata");
    var { DEFAULT_LEVELS } = require_constants();
    var DEFAULT_INFO_LEVEL = DEFAULT_LEVELS.info;
    function multistream(streamsArray, opts) {
      streamsArray = streamsArray || [];
      opts = opts || { dedupe: false };
      const streamLevels = Object.create(DEFAULT_LEVELS);
      streamLevels.silent = Infinity;
      if (opts.levels && typeof opts.levels === "object") {
        Object.keys(opts.levels).forEach((i) => {
          streamLevels[i] = opts.levels[i];
        });
      }
      const res = {
        write,
        add,
        remove,
        emit,
        flushSync,
        end,
        minLevel: 0,
        lastId: 0,
        streams: [],
        clone,
        [metadata]: true,
        streamLevels
      };
      if (Array.isArray(streamsArray)) {
        streamsArray.forEach(add, res);
      } else {
        add.call(res, streamsArray);
      }
      streamsArray = null;
      return res;
      function write(data) {
        let dest;
        const level = this.lastLevel;
        const { streams } = this;
        let recordedLevel = 0;
        let stream;
        for (let i = initLoopVar(streams.length, opts.dedupe); checkLoopVar(i, streams.length, opts.dedupe); i = adjustLoopVar(i, opts.dedupe)) {
          dest = streams[i];
          if (dest.level <= level) {
            if (recordedLevel !== 0 && recordedLevel !== dest.level) {
              break;
            }
            stream = dest.stream;
            if (stream[metadata]) {
              const { lastTime, lastMsg, lastObj, lastLogger } = this;
              stream.lastLevel = level;
              stream.lastTime = lastTime;
              stream.lastMsg = lastMsg;
              stream.lastObj = lastObj;
              stream.lastLogger = lastLogger;
            }
            stream.write(data);
            if (opts.dedupe) {
              recordedLevel = dest.level;
            }
          } else if (!opts.dedupe) {
            break;
          }
        }
      }
      function emit(...args) {
        for (const { stream } of this.streams) {
          if (typeof stream.emit === "function") {
            stream.emit(...args);
          }
        }
      }
      function flushSync() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
        }
      }
      function add(dest) {
        if (!dest) {
          return res;
        }
        const isStream = typeof dest.write === "function" || dest.stream;
        const stream_ = dest.write ? dest : dest.stream;
        if (!isStream) {
          throw Error("stream object needs to implement either StreamEntry or DestinationStream interface");
        }
        const { streams, streamLevels: streamLevels2 } = this;
        let level;
        if (typeof dest.levelVal === "number") {
          level = dest.levelVal;
        } else if (typeof dest.level === "string") {
          level = streamLevels2[dest.level];
        } else if (typeof dest.level === "number") {
          level = dest.level;
        } else {
          level = DEFAULT_INFO_LEVEL;
        }
        const dest_ = {
          stream: stream_,
          level,
          levelVal: void 0,
          id: ++res.lastId
        };
        streams.unshift(dest_);
        streams.sort(compareByLevel);
        this.minLevel = streams[0].level;
        return res;
      }
      function remove(id) {
        const { streams } = this;
        const index = streams.findIndex((s) => s.id === id);
        if (index >= 0) {
          streams.splice(index, 1);
          streams.sort(compareByLevel);
          this.minLevel = streams.length > 0 ? streams[0].level : -1;
        }
        return res;
      }
      function end() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
          stream.end();
        }
      }
      function clone(level) {
        const streams = new Array(this.streams.length);
        for (let i = 0; i < streams.length; i++) {
          streams[i] = {
            level,
            stream: this.streams[i].stream
          };
        }
        return {
          write,
          add,
          remove,
          minLevel: level,
          streams,
          clone,
          emit,
          flushSync,
          [metadata]: true
        };
      }
    }
    function compareByLevel(a, b) {
      return a.level - b.level;
    }
    function initLoopVar(length, dedupe) {
      return dedupe ? length - 1 : 0;
    }
    function adjustLoopVar(i, dedupe) {
      return dedupe ? i - 1 : i + 1;
    }
    function checkLoopVar(i, length, dedupe) {
      return dedupe ? i >= 0 : i < length;
    }
    module2.exports = multistream;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/pino.js
var require_pino = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/pino.js"(exports2, module2) {
    "use strict";
    var os = require("node:os");
    var stdSerializers = require_pino_std_serializers();
    var caller = require_caller();
    var redaction = require_redaction();
    var time = require_time();
    var proto = require_proto();
    var symbols = require_symbols();
    var { configure } = require_safe_stable_stringify();
    var { assertDefaultLevelFound, mappings, genLsCache, genLevelComparison, assertLevelComparison } = require_levels();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var {
      createArgsNormalizer,
      asChindings,
      buildSafeSonicBoom,
      buildFormatters,
      stringify,
      normalizeDestFileDescriptor,
      noop
    } = require_tools();
    var { version } = require_meta();
    var {
      chindingsSym,
      redactFmtSym,
      serializersSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      setLevelSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      mixinSym,
      levelCompSym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    } = symbols;
    var { epochTime, nullTime } = time;
    var { pid } = process;
    var hostname = os.hostname();
    var defaultErrorSerializer = stdSerializers.err;
    var defaultOptions = {
      level: "info",
      levelComparison: SORTING_ORDER.ASC,
      levels: DEFAULT_LEVELS,
      messageKey: "msg",
      errorKey: "err",
      nestedKey: null,
      enabled: true,
      base: { pid, hostname },
      serializers: Object.assign(/* @__PURE__ */ Object.create(null), {
        err: defaultErrorSerializer
      }),
      formatters: Object.assign(/* @__PURE__ */ Object.create(null), {
        bindings(bindings) {
          return bindings;
        },
        level(label, number) {
          return { level: number };
        }
      }),
      hooks: {
        logMethod: void 0,
        streamWrite: void 0
      },
      timestamp: epochTime,
      name: void 0,
      redact: null,
      customLevels: null,
      useOnlyCustomLevels: false,
      depthLimit: 5,
      edgeLimit: 100
    };
    var normalize = createArgsNormalizer(defaultOptions);
    var serializers = Object.assign(/* @__PURE__ */ Object.create(null), stdSerializers);
    function pino2(...args) {
      const instance = {};
      const { opts, stream } = normalize(instance, caller(), ...args);
      if (opts.level && typeof opts.level === "string" && DEFAULT_LEVELS[opts.level.toLowerCase()] !== void 0) opts.level = opts.level.toLowerCase();
      const {
        redact,
        crlf,
        serializers: serializers2,
        timestamp,
        messageKey,
        errorKey,
        nestedKey,
        base,
        name,
        level,
        customLevels,
        levelComparison,
        mixin,
        mixinMergeStrategy,
        useOnlyCustomLevels,
        formatters,
        hooks,
        depthLimit,
        edgeLimit,
        onChild,
        msgPrefix
      } = opts;
      const stringifySafe = configure({
        maximumDepth: depthLimit,
        maximumBreadth: edgeLimit
      });
      const allFormatters = buildFormatters(
        formatters.level,
        formatters.bindings,
        formatters.log
      );
      const stringifyFn = stringify.bind({
        [stringifySafeSym]: stringifySafe
      });
      const stringifiers = redact ? redaction(redact, stringifyFn) : {};
      const formatOpts = redact ? { stringify: stringifiers[redactFmtSym] } : { stringify: stringifyFn };
      const end = "}" + (crlf ? "\r\n" : "\n");
      const coreChindings = asChindings.bind(null, {
        [chindingsSym]: "",
        [serializersSym]: serializers2,
        [stringifiersSym]: stringifiers,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [formattersSym]: allFormatters
      });
      let chindings = "";
      if (base !== null) {
        if (name === void 0) {
          chindings = coreChindings(base);
        } else {
          chindings = coreChindings(Object.assign({}, base, { name }));
        }
      }
      const time2 = timestamp instanceof Function ? timestamp : timestamp ? epochTime : nullTime;
      const timeSliceIndex = time2().indexOf(":") + 1;
      if (useOnlyCustomLevels && !customLevels) throw Error("customLevels is required if useOnlyCustomLevels is set true");
      if (mixin && typeof mixin !== "function") throw Error(`Unknown mixin type "${typeof mixin}" - expected "function"`);
      if (msgPrefix && typeof msgPrefix !== "string") throw Error(`Unknown msgPrefix type "${typeof msgPrefix}" - expected "string"`);
      assertDefaultLevelFound(level, customLevels, useOnlyCustomLevels);
      const levels = mappings(customLevels, useOnlyCustomLevels);
      if (typeof stream.emit === "function") {
        stream.emit("message", { code: "PINO_CONFIG", config: { levels, messageKey, errorKey } });
      }
      assertLevelComparison(levelComparison);
      const levelCompFunc = genLevelComparison(levelComparison);
      Object.assign(instance, {
        levels,
        [levelCompSym]: levelCompFunc,
        [useOnlyCustomLevelsSym]: useOnlyCustomLevels,
        [streamSym]: stream,
        [timeSym]: time2,
        [timeSliceIndexSym]: timeSliceIndex,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [stringifiersSym]: stringifiers,
        [endSym]: end,
        [formatOptsSym]: formatOpts,
        [messageKeySym]: messageKey,
        [errorKeySym]: errorKey,
        [nestedKeySym]: nestedKey,
        // protect against injection
        [nestedKeyStrSym]: nestedKey ? `,${JSON.stringify(nestedKey)}:{` : "",
        [serializersSym]: serializers2,
        [mixinSym]: mixin,
        [mixinMergeStrategySym]: mixinMergeStrategy,
        [chindingsSym]: chindings,
        [formattersSym]: allFormatters,
        [hooksSym]: hooks,
        silent: noop,
        onChild,
        [msgPrefixSym]: msgPrefix
      });
      Object.setPrototypeOf(instance, proto());
      genLsCache(instance);
      instance[setLevelSym](level);
      return instance;
    }
    module2.exports = pino2;
    module2.exports.destination = (dest = process.stdout.fd) => {
      if (typeof dest === "object") {
        dest.dest = normalizeDestFileDescriptor(dest.dest || process.stdout.fd);
        return buildSafeSonicBoom(dest);
      } else {
        return buildSafeSonicBoom({ dest: normalizeDestFileDescriptor(dest), minLength: 0 });
      }
    };
    module2.exports.transport = require_transport();
    module2.exports.multistream = require_multistream();
    module2.exports.levels = mappings();
    module2.exports.stdSerializers = serializers;
    module2.exports.stdTimeFunctions = Object.assign({}, time);
    module2.exports.symbols = symbols;
    module2.exports.version = version;
    module2.exports.default = pino2;
    module2.exports.pino = pino2;
  }
});

// src/lib/mikrotik.ts
var mikrotik_exports = {};
__export(mikrotik_exports, {
  RouterFileExistsError: () => RouterFileExistsError,
  addDstNatRule: () => addDstNatRule,
  addHotspotIpBinding: () => addHotspotIpBinding,
  addHotspotUser: () => addHotspotUser,
  addHotspotUserProfile: () => addHotspotUserProfile,
  addIpPool: () => addIpPool,
  addIpToAddressList: () => addIpToAddressList,
  addPPPProfile: () => addPPPProfile,
  addPPPSecret: () => addPPPSecret,
  assignBridgePorts: () => assignBridgePorts,
  changeHotspotUsername: () => changeHotspotUsername,
  changePPPSecretName: () => changePPPSecretName,
  classifyRouterConnectionFailure: () => classifyRouterConnectionFailure,
  connectHotspotUser: () => connectHotspotUser,
  createBridge: () => createBridge,
  deployRouterFile: () => deployRouterFile,
  detectBridgeInterfaces: () => detectBridgeInterfaces,
  disableGeneratedHotspot: () => disableGeneratedHotspot,
  disconnectHotspotActiveUser: () => disconnectHotspotActiveUser,
  disconnectPPPActive: () => disconnectPPPActive,
  disconnectPPPActiveByName: () => disconnectPPPActiveByName,
  ensureHotspotServerAddressPool: () => ensureHotspotServerAddressPool,
  ensureHotspotUserProfile: () => ensureHotspotUserProfile,
  ensureHotspotUserRateQueue: () => ensureHotspotUserRateQueue,
  ensureRouterHttpsTrust: () => ensureRouterHttpsTrust,
  ensureRouterManagementAccess: () => ensureRouterManagementAccess,
  fetchBridgePortLayout: () => fetchBridgePortLayout,
  fetchHotspotConnectedDevices: () => fetchHotspotConnectedDevices,
  fetchHotspotUserList: () => fetchHotspotUserList,
  fetchHotspotUsers: () => fetchHotspotUsers,
  fetchInterfaces: () => fetchInterfaces,
  fetchIpPools: () => fetchIpPools,
  fetchPPPProfiles: () => fetchPPPProfiles,
  fetchPPPSecrets: () => fetchPPPSecrets,
  fetchPPPoEActive: () => fetchPPPoEActive,
  fetchRouterFiles: () => fetchRouterFiles,
  fetchRouterLiveData: () => fetchRouterLiveData,
  fetchRouterSecurityState: () => fetchRouterSecurityState,
  fetchTraffic: () => fetchTraffic,
  fetchWireless: () => fetchWireless,
  generateFirewallScript: () => generateFirewallScript,
  generateNetworkSetupScript: () => generateNetworkSetupScript,
  generateOvpnClientConfig: () => generateOvpnClientConfig,
  generateRouterAsClientScript: () => generateRouterAsClientScript,
  generateRouterIpsecClientScript: () => generateRouterIpsecClientScript,
  generateRouterManagementVpnScript: () => generateRouterManagementVpnScript,
  generateRouterWireGuardClientScript: () => generateRouterWireGuardClientScript,
  generateServiceSetupScript: () => generateServiceSetupScript,
  generateVpnSetupScript: () => generateVpnSetupScript,
  getEnvCredentials: () => getEnvCredentials,
  getHotspotUserIp: () => getHotspotUserIp,
  isHotspotUserOnline: () => isHotspotUserOnline,
  isPPPUserOnline: () => isPPPUserOnline,
  isPrivateIp: () => isPrivateIp,
  pingRouter: () => pingRouter,
  probeAllHosts: () => probeAllHosts,
  probePort: () => probePort,
  reconcileGeneratedServiceConfiguration: () => reconcileGeneratedServiceConfiguration,
  reconcileHotspotUserAccess: () => reconcileHotspotUserAccess,
  reconcilePppoeUserAccess: () => reconcilePppoeUserAccess,
  removeDstNatByAddress: () => removeDstNatByAddress,
  removeHotspotIpBinding: () => removeHotspotIpBinding,
  removeHotspotUser: () => removeHotspotUser,
  removeHotspotUserExpiry: () => removeHotspotUserExpiry,
  removeHotspotUserProfile: () => removeHotspotUserProfile,
  removeHotspotUserRateQueue: () => removeHotspotUserRateQueue,
  removeIpFromAddressList: () => removeIpFromAddressList,
  removeIpPool: () => removeIpPool,
  removePPPProfile: () => removePPPProfile,
  removePPPSecret: () => removePPPSecret,
  removePPPSecretByName: () => removePPPSecretByName,
  removePppUserExpiry: () => removePppUserExpiry,
  repairGeneratedServiceNetworking: () => repairGeneratedServiceNetworking,
  requireHotspotUserProfile: () => requireHotspotUserProfile,
  resetHotspotUserCounters: () => resetHotspotUserCounters,
  resolveHotspotClientMac: () => resolveHotspotClientMac,
  runRouterCommand: () => runRouterCommand,
  scheduleHotspotUserExpiry: () => scheduleHotspotUserExpiry,
  schedulePppUserExpiry: () => schedulePppUserExpiry,
  setWirelessInterface: () => setWirelessInterface,
  setWirelessSecurityProfile: () => setWirelessSecurityProfile,
  syncHotspotPortalHostname: () => syncHotspotPortalHostname,
  testConnection: () => testConnection,
  updateHotspotUser: () => updateHotspotUser,
  updateHotspotUserProfile: () => updateHotspotUserProfile,
  updateIpPool: () => updateIpPool,
  updatePPPProfile: () => updatePPPProfile,
  updatePPPSecret: () => updatePPPSecret
});
module.exports = __toCommonJS(mikrotik_exports);
var net2 = __toESM(require("net"), 1);
var import_node_crypto = require("node:crypto");
var import_node_routeros = require("node-routeros");

// src/lib/logger.ts
var import_pino = __toESM(require_pino(), 1);
var isProduction = process.env.NODE_ENV === "production";
var logger = (0, import_pino.default)({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']"
  ],
  ...isProduction ? {} : {
    transport: {
      target: "pino-pretty",
      options: { colorize: true }
    }
  }
});

// src/lib/router-management-vpn.ts
var ROUTER_MANAGEMENT_VPN = {
  port: 1196,
  publicPortBase: 11960,
  protocol: "tcp",
  tunnelBase: "10.8.5",
  network: "10.8.5.0/24",
  gateway: "10.8.5.1",
  interfaceName: "tun-router",
  configPath: "/etc/openvpn/server/ochola-router.conf",
  authFilePath: "/etc/openvpn/router-passwd",
  authScriptPath: "/etc/openvpn/verify-router-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-ccd",
  statusPath: "/var/log/openvpn/ochola-router-status.log",
  ippPath: "/etc/openvpn/router-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt"
  ]
};
var ROUTER_MANAGEMENT_VPN_BACKUP = {
  port: 1197,
  protocol: "tcp",
  tunnelBase: "10.8.6",
  network: "10.8.6.0/24",
  gateway: "10.8.6.1",
  // Linux/OpenVPN truncates TUN device names longer than 15 characters.
  // Keep this name short so the configured and observed interface match.
  interfaceName: "tun-router-bkp",
  configPath: "/etc/openvpn/server/ochola-router-backup.conf",
  authFilePath: "/etc/openvpn/router-backup-passwd",
  authScriptPath: "/etc/openvpn/verify-router-backup-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-backup-ccd",
  statusPath: "/var/log/openvpn/ochola-router-backup-status.log",
  ippPath: "/etc/openvpn/router-backup-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt"
  ]
};
var ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME = "ocholasupernet";
var ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT = "mainbillingvpn";
function routerManagementClientInterfaceName(routerId, role = "primary") {
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    throw new Error("A valid router id is required to name the management VPN interface.");
  }
  return `ochola-mgmt-vpn-${routerId}${role === "backup" ? "-backup" : ""}`;
}
function routerManagementBackupIp(primaryIp) {
  const match = /^10\.8\.5\.(\d+)$/.exec(String(primaryIp ?? "").trim());
  const host = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(host) || host < 2 || host > 254) {
    throw new Error(`Router management address cannot map to the backup pool: ${primaryIp}`);
  }
  return `10.8.6.${host}`;
}

// src/lib/router-https-trust.ts
var import_node_fs = require("node:fs");
var import_meta = {};
var ISRG_ROOT_X1_PEM = (0, import_node_fs.readFileSync)(
  new URL("./certificates/isrg-root-x1.pem", import_meta.url),
  "utf8"
);
var ROUTER_HTTPS_CERTIFICATE_NAME = "ochola-isrg-root-x1";
var ROUTER_HTTPS_CERTIFICATE_FILE = "ochola-isrg-root-x1.pem";
var ROUTER_HTTPS_CERTIFICATE_PATH = `/scripts/${ROUTER_HTTPS_CERTIFICATE_FILE}`;
function routerOsTextVariableWriter(value, variableName = "caText", indent = "") {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 0) throw new Error("Cannot render an empty RouterOS text value.");
  const escaped = (line) => line.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const output = [`${indent}:local ${variableName} "${escaped(lines[0])}"`];
  for (const line of lines.slice(1)) {
    output.push(
      `${indent}:set ${variableName} ($${variableName} . "\\n" . "${escaped(line)}")`
    );
  }
  return output.join("\n");
}

// src/lib/vps-ssh.ts
var import_fs = require("fs");
var import_child_process = require("child_process");
var import_crypto = require("crypto");
var net = __toESM(require("net"), 1);
var OUTPUT_LIMIT = 128 * 1024;
function configuredKeys() {
  return [
    process.env.VPS_DEPLOYMENT_KEY_V3,
    process.env.VPS_DEPLOYMENT_KEY_V2,
    process.env.VPS_DEPLOYMENT_KEY,
    process.env.VPS_SSH_KEY
  ].map((value) => normalizePrivateKey(value ?? "")).filter(Boolean);
}
function normalizePrivateKey(value) {
  let key = value.trim();
  if (!key) return "";
  if (key.startsWith("base64:")) {
    const encoded = key.slice("base64:".length).replace(/\s+/g, "");
    try {
      key = Buffer.from(encoded, "base64").toString("utf8").trim();
    } catch {
      return "";
    }
  }
  if (!key.includes("\n") && key.includes("\\n") && key.includes("-----BEGIN")) {
    key = key.replaceAll("\\n", "\n");
  }
  key = key.replace(/\r\n?/g, "\n");
  return key.endsWith("\n") ? key : `${key}
`;
}
function b64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
function configuredPassphrase() {
  const encoded = process.env.VPS_SSH_PASSPHRASE_B64?.trim() ?? "";
  if (encoded.startsWith("base64:")) {
    try {
      return Buffer.from(encoded.slice("base64:".length), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return process.env.VPS_SSH_PASSPHRASE ?? "";
}
function appendBounded(current, chunk) {
  const next = current + chunk.toString();
  return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}
function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function waitForForward(child, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish(new Error("VPS SSH port forward exited before becoming ready."));
    const onError = () => finish(new Error("VPS SSH port forward could not start."));
    const probe = () => {
      if (settled) return;
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(Math.min(500, Math.max(100, timeoutMs)));
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("timeout", () => socket.destroy());
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          finish(new Error(`VPS SSH port forward timed out after ${timeoutMs}ms.`));
        } else {
          timer = setTimeout(probe, 100);
        }
      });
    };
    child.once("close", onClose);
    child.once("error", onError);
    probe();
  });
}
async function openVpsTcpForward(remoteHost, remotePort, options = {}) {
  const host = remoteHost.trim();
  if (!/^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(host)) {
    throw new Error("VPS TCP forwarding is restricted to a router management 10.8.5.x or 10.8.6.x address.");
  }
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error("VPS TCP forwarding requires a valid remote port.");
  }
  const vpsHost = process.env.VPS_HOST?.trim() ?? "";
  const vpsUser = process.env.VPS_USER?.trim() ?? "";
  const keys = configuredKeys();
  if (!vpsHost || !vpsUser || keys.length === 0) {
    throw new Error("VPS_HOST, VPS_USER, and a VPS SSH key are required for router management forwarding.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(vpsHost)) {
    throw new Error("VPS_HOST must point to the remote production VPS.");
  }
  const timeoutMs = Math.max(5e3, options.timeoutMs ?? 15e3);
  const localPort = await reserveLocalPort();
  const askPassPath = `/tmp/ochola-vps-forward-askpass-${(0, import_crypto.randomUUID)()}`;
  const passphrase = configuredPassphrase();
  if (passphrase) {
    (0, import_fs.writeFileSync)(
      askPassPath,
      `#!/bin/sh
printf '%s' '${b64(passphrase)}' | base64 -d
`,
      { mode: 448 }
    );
    (0, import_fs.chmodSync)(askPassPath, 448);
  }
  let lastError = "All configured VPS SSH keys failed.";
  try {
    for (const key of keys) {
      const keyPath = `/tmp/ochola-vps-forward-key-${(0, import_crypto.randomUUID)()}`;
      let child;
      try {
        (0, import_fs.writeFileSync)(keyPath, key, { mode: 384 });
        (0, import_fs.chmodSync)(keyPath, 384);
        const args = [
          "-i",
          keyPath,
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ExitOnForwardFailure=yes",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=2",
          "-o",
          passphrase ? "BatchMode=no" : "BatchMode=yes",
          "-N",
          "-L",
          `127.0.0.1:${localPort}:${host}:${remotePort}`,
          `${vpsUser}@${vpsHost}`
        ];
        const env = { ...process.env };
        if (passphrase) {
          env.SSH_ASKPASS = askPassPath;
          env.SSH_ASKPASS_REQUIRE = "force";
          env.DISPLAY = env.DISPLAY || "none";
        }
        child = (0, import_child_process.spawn)("ssh", args, { env, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
          stderr = appendBounded(stderr, chunk);
        });
        await waitForForward(child, localPort, timeoutMs);
        try {
          (0, import_fs.unlinkSync)(askPassPath);
        } catch {
        }
        let closed = false;
        const close = async () => {
          if (closed) return;
          closed = true;
          await new Promise((resolve) => {
            const forceTimer = setTimeout(() => {
              child?.kill("SIGKILL");
              resolve();
            }, 2e3);
            child?.once("close", () => {
              clearTimeout(forceTimer);
              resolve();
            });
            child?.kill("SIGTERM");
          });
          try {
            (0, import_fs.unlinkSync)(keyPath);
          } catch {
          }
        };
        return { host: "127.0.0.1", port: localPort, close };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        child?.kill("SIGKILL");
      } finally {
        if (!child || child.exitCode !== null) {
          try {
            (0, import_fs.unlinkSync)(keyPath);
          } catch {
          }
        }
      }
    }
  } finally {
    try {
      (0, import_fs.unlinkSync)(askPassPath);
    } catch {
    }
  }
  throw new Error(lastError);
}

// src/lib/payment-walled-garden.ts
var PAYMENT_WALLED_GARDEN_HOSTNAMES = [
  // Safaricom M-Pesa Daraja
  "api.safaricom.co.ke",
  "sandbox.safaricom.co.ke",
  // Airtel Money
  "openapi.airtel.africa",
  // AzamPay
  "api.azampay.co.tz",
  "checkout.azampay.co.tz",
  "sandbox.azampay.co.tz",
  // Flutterwave
  "api.flutterwave.com",
  "checkout.flutterwave.com",
  // IntaSend
  "api.intasend.com",
  "payment.intasend.com",
  // PesaPal
  "pay.pesapal.com",
  "www.pesapal.com",
  "cybqa.pesapal.com",
  // Stripe
  "api.stripe.com",
  "checkout.stripe.com",
  "js.stripe.com",
  // PayPal
  "api-m.paypal.com",
  "www.paypal.com",
  "www.paypalobjects.com",
  // Tigo Pesa
  "api.tigo.co.tz",
  // DPO / 3G Direct Pay
  "secure.3gdirectpay.com",
  "pay.dpo-group.com",
  // Xendit
  "api.xendit.co",
  "checkout.xendit.co"
];

// src/lib/shared-hotspot-resources.ts
var SHARED_HOTSPOT_SERVER_NAME = "hotspot";
var SHARED_HOTSPOT_POOL_NAME = "hotspot pool";
var SHARED_HOTSPOT_PROFILE_NAME = "hsprof";
function legacySharedHotspotResourceNames(routerId) {
  const tag = `ochola-services-${routerId}`;
  return {
    serverName: `${tag}-hotspot`,
    poolName: `${tag}-hotspot-pool`
  };
}

// src/lib/mikrotik.ts
var PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^::1$/,
  /^localhost$/i
];
function isPrivateIp(host) {
  return PRIVATE_RANGES.some((r) => r.test(host.trim()));
}
var DEFAULT_CONNECT_MS = parseInt(
  process.env["MIKROTIK_CONNECT_TIMEOUT"] ?? "15000",
  10
);
var DEFAULT_REQUEST_MS = parseInt(
  process.env["MIKROTIK_REQUEST_TIMEOUT"] ?? "20000",
  10
);
var MAX_RETRIES = parseInt(
  process.env["MIKROTIK_MAX_RETRIES"] ?? "2",
  10
);
function getEnvCredentials() {
  const host = process.env["MIKROTIK_HOST"]?.trim();
  if (!host) return null;
  const password = process.env["MIKROTIK_PASSWORD"] ?? "";
  const username = process.env["MIKROTIK_USERNAME"] ?? "admin";
  const bridgeIp = process.env["MIKROTIK_BRIDGE_IP"]?.trim() || void 0;
  const useSSL = process.env["MIKROTIK_USE_SSL"]?.toLowerCase() === "true";
  const rawPort = process.env["MIKROTIK_PORT"];
  const port = rawPort ? parseInt(rawPort, 10) : useSSL ? 8729 : 8728;
  if (!password) {
    logger.warn("MIKROTIK_PASSWORD is not set \u2014 connection will likely fail");
  }
  if (isPrivateIp(host)) {
    logger.warn(
      { host },
      "MIKROTIK_HOST appears to be a private/local IP. The VPS cannot reach this address over the internet. Use the router's public IP or set MIKROTIK_BRIDGE_IP for VPN tunnel access."
    );
  }
  return {
    host,
    port,
    username,
    password,
    useSSL: useSSL || port === 8729,
    bridgeIp
  };
}
function makeConn(host, creds) {
  const ssl = creds.useSSL ?? creds.port === 8729;
  const connectSec = Math.ceil((creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS) / 1e3);
  return new import_node_routeros.RouterOSAPI({
    host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    timeout: connectSec,
    keepalive: false,
    ...ssl ? {
      tls: {
        /* RouterOS uses self-signed certs by default.
           Set MIKROTIK_TLS_VERIFY=true only if the router has
           a properly signed certificate installed.               */
        rejectUnauthorized: process.env["MIKROTIK_TLS_VERIFY"] === "true"
      }
    } : {}
  });
}
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Operation timed out after ${ms / 1e3}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function classifyRouterConnectionFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("login failed") || lower.includes("authentication") || lower.includes("bad credentials") || lower.includes("invalid user") || lower.includes("invalid password") || lower.includes("not authorized")) {
    return {
      profile: "bad_credentials",
      summary: "Bad Credentials handshake",
      message
    };
  }
  if (lower.includes("management api forward failed") || lower.includes("openvpn") || lower.includes("tunnel is offline")) {
    return {
      profile: "offline_vpn_tunnel",
      summary: "Offline VPN tunnel container state",
      message
    };
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("etimedout") || lower.includes("ehostunreach") || lower.includes("enetunreach") || lower.includes("econnrefused") || lower.includes("not reachable") || lower.includes("port 8728")) {
    return {
      profile: "tcp_timeout",
      summary: "TCP Timeout (Port 8728 blocked/unreachable)",
      message
    };
  }
  return { profile: "unknown", summary: "Unknown RouterOS connection failure", message };
}
async function probePort(host, port, timeoutMs = 5e3) {
  const start = Date.now();
  return new Promise((resolve) => {
    const sock = new net2.Socket();
    let done = false;
    const finish = (reachable, errorMsg) => {
      if (done) return;
      done = true;
      sock.destroy();
      const latencyMs = Date.now() - start;
      let diagnosis;
      if (!reachable && errorMsg) {
        if (errorMsg.includes("ECONNREFUSED")) {
          diagnosis = `Port ${port} was reached but refused \u2014 the RouterOS API service may be disabled. Enable it under /ip service on the router.`;
        } else if (errorMsg.includes("ETIMEDOUT") || errorMsg.toLowerCase().includes("timed out")) {
          diagnosis = `Port ${port} did not respond within ${timeoutMs / 1e3}s \u2014 likely blocked by a firewall DROP rule or NAT is not forwarding port ${port} to the router. Check /ip firewall filter and port-forward rules.`;
        } else if (errorMsg.includes("EHOSTUNREACH") || errorMsg.includes("ENETUNREACH")) {
          diagnosis = `Host ${host} is unreachable \u2014 routing failure. Verify the IP is correct and the VPS has a network path to it. If behind NAT with no public IP, configure a VPN tunnel instead.`;
        } else if (errorMsg.includes("ENOTFOUND")) {
          diagnosis = `Hostname "${host}" could not be resolved. Use the router's IP address directly instead of a hostname, or ensure DNS is correctly configured on the VPS.`;
        } else if (errorMsg.includes("EACCES")) {
          diagnosis = `Permission denied connecting to ${host}:${port}. Check OS-level firewall rules on the VPS (iptables/ufw).`;
        }
      }
      resolve({ host, port, reachable, latencyMs, error: errorMsg, diagnosis });
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => finish(true));
    sock.on("error", (err) => finish(false, err.message));
    sock.on("timeout", () => finish(false, `Timed out after ${timeoutMs / 1e3}s`));
    sock.connect(port, host);
  });
}
async function connectWithRetry(creds) {
  const connectMs = creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  const probeMs = Math.min(connectMs, 6e3);
  const hosts = [];
  const isVpnIp = (ip) => /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(ip);
  if (creds.host) {
    const vpn = isVpnIp(creds.host);
    const label = vpn ? `${creds.host} (VPN tunnel)` : isPrivateIp(creds.host) ? `${creds.host} (\u26A0 LAN IP \u2014 only reachable on local network)` : creds.host;
    hosts.push({ host: creds.host, label, isVpn: vpn });
    if (/^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(creds.host)) {
      const backupIp = creds.host.startsWith("10.8.5.") ? routerManagementBackupIp(creds.host) : creds.host.replace(/^10\.8\.6\./, "10.8.5.");
      hosts.push({ host: backupIp, label: `${backupIp} (alternate management VPN tunnel)`, isVpn: true });
    }
  }
  if (creds.bridgeIp && creds.bridgeIp !== creds.host) {
    hosts.push({ host: creds.bridgeIp, label: `${creds.bridgeIp} (VPN tunnel)`, isVpn: true });
    if (/^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(creds.bridgeIp)) {
      const backupIp = creds.bridgeIp.startsWith("10.8.5.") ? routerManagementBackupIp(creds.bridgeIp) : creds.bridgeIp.replace(/^10\.8\.6\./, "10.8.5.");
      hosts.push({ host: backupIp, label: `${backupIp} (alternate management VPN tunnel)`, isVpn: true });
    }
  }
  if (hosts.length === 0) {
    throw new Error("No host or bridge IP configured for this router");
  }
  const usernames = Array.from(new Set([
    creds.username,
    ...creds.alternateUsernames ?? []
  ].map((username) => username.trim()).filter(Boolean)));
  hosts.sort((a, b) => (b.isVpn ? 1 : 0) - (a.isVpn ? 1 : 0));
  let lastErr = new Error("No connection attempts made");
  let lastProbe = { host: "", port: creds.port, reachable: false, latencyMs: 0 };
  for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES); attempt++) {
    for (const { host, label, isVpn } of hosts) {
      let forward;
      let connectionHost = host;
      let connectionPort = creds.port;
      logger.debug({ host: label, port: creds.port, attempt }, "Port probe");
      if (isVpn) {
        try {
          forward = await openVpsTcpForward(host, creds.port, { timeoutMs: connectMs });
          connectionHost = forward.host;
          connectionPort = forward.port;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          logger.warn({ host: label, attempt, err: lastErr.message }, "VPS management API forward failed");
          continue;
        }
      }
      const rawProbe = await probePort(connectionHost, connectionPort, probeMs);
      const probe = isVpn ? { ...rawProbe, host, port: creds.port } : rawProbe;
      lastProbe = probe;
      if (!probe.reachable) {
        const diag = probe.diagnosis ?? probe.error ?? "unreachable";
        logger.warn(
          { host: label, port: creds.port, attempt, diagnosis: diag },
          "Port probe failed \u2014 skipping RouterOS API connect"
        );
        lastErr = new Error(
          `Port ${creds.port} on ${label} is not reachable (attempt ${attempt}/${MAX_RETRIES}): ${diag}`
        );
        await forward?.close();
        continue;
      }
      logger.debug({ host: label, port: creds.port, latencyMs: probe.latencyMs }, "Port open");
      for (const username of usernames) {
        const conn = makeConn(connectionHost, { ...creds, username, host: connectionHost, port: connectionPort });
        try {
          logger.debug({ host: label, username, attempt }, "RouterOS API connect");
          await withTimeout(conn.connect(), connectMs);
          logger.debug({ host: label, username, attempt }, "RouterOS API connected");
          return {
            conn,
            connectedHost: host,
            probe,
            closeForward: forward ? () => forward.close() : void 0
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ host: label, username, attempt, err: msg }, "RouterOS API connect failed");
          lastErr = new Error(
            `Port ${creds.port} is open on ${isVpn ? "VPN" : "public"} host ${label} but RouterOS API login failed for ${username} (attempt ${attempt}/${MAX_RETRIES}): ${msg}. Check the API username and password, and that the API service is enabled.`
          );
          try {
            conn.close();
          } catch {
          }
        }
      }
      await forward?.close();
    }
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 4e3);
      logger.debug({ attempt, delayMs: delay }, "Retry backoff");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw Object.assign(lastErr, { probe: lastProbe });
}
async function withConn(creds, fn) {
  const { conn, connectedHost, closeForward } = await connectWithRetry(creds);
  try {
    return await fn(conn, connectedHost);
  } finally {
    try {
      conn.close();
    } catch {
    }
    await closeForward?.();
  }
}
async function runRouterCommand(creds, command) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    return withTimeout(conn.write(command), ms);
  });
}
async function ensureHotspotServerAddressPool(creds, opts) {
  const poolRows = await runRouterCommand(creds, [
    "/ip/pool/print",
    "=.proplist=.id,name,ranges",
    `?name=${opts.poolName}`
  ]);
  const pool = (Array.isArray(poolRows) ? poolRows : []).find((row) => row.name === opts.poolName);
  const existingRanges = String(pool?.ranges ?? "").trim();
  if (!existingRanges) {
    const poolCommand = pool?.[".id"] ? ["/ip/pool/set", `=.id=${pool[".id"]}`] : ["/ip/pool/add", `=name=${opts.poolName}`];
    poolCommand.push(`=ranges=${opts.poolRanges}`);
    if (opts.comment) poolCommand.push(`=comment=${opts.comment}`);
    await runRouterCommand(creds, poolCommand);
  }
  const serverRows = await runRouterCommand(creds, [
    "/ip/hotspot/print",
    "=.proplist=.id,name,address-pool",
    `?name=${opts.serverName}`
  ]);
  const server = (Array.isArray(serverRows) ? serverRows : []).find((row) => row.name === opts.serverName);
  if (!server?.[".id"]) {
    throw new Error(`Hotspot server "${opts.serverName}" is not deployed on the router.`);
  }
  if (server["address-pool"] !== opts.poolName) {
    await runRouterCommand(creds, [
      "/ip/hotspot/set",
      `=.id=${server[".id"]}`,
      `=address-pool=${opts.poolName}`
    ]);
  }
}
async function disableGeneratedHotspot(creds, routerId) {
  const legacy = legacySharedHotspotResourceNames(routerId);
  const rows = await runRouterCommand(creds, [
    "/ip/hotspot/print",
    "=.proplist=.id,name,disabled"
  ]);
  const server = (Array.isArray(rows) ? rows : []).find((row) => row.name === SHARED_HOTSPOT_SERVER_NAME) ?? (Array.isArray(rows) ? rows : []).find((row) => row.name === legacy.serverName);
  const name = server?.name ?? SHARED_HOTSPOT_SERVER_NAME;
  if (!server?.[".id"]) {
    throw new Error(`Generated Hotspot server "${name}" was not found on the router.`);
  }
  const alreadyDisabled = String(server.disabled ?? "").toLowerCase() === "true";
  if (!alreadyDisabled) {
    await runRouterCommand(creds, [
      "/ip/hotspot/set",
      `=.id=${server[".id"]}`,
      "=disabled=yes"
    ]);
  }
  return { name, alreadyDisabled };
}
async function reconcileGeneratedServiceConfiguration(creds, routerId) {
  const tag = `ochola-services-${routerId}`;
  const hotspotName = SHARED_HOTSPOT_SERVER_NAME;
  const hotspotPool = SHARED_HOTSPOT_POOL_NAME;
  const hotspotProfile = SHARED_HOTSPOT_PROFILE_NAME;
  const legacy = legacySharedHotspotResourceNames(routerId);
  const dhcpServer = `${tag}-dhcp`;
  const pppoePool = `${tag}-pppoe-pool`;
  const pppoeProfile = `${tag}-pppoe-profile`;
  const pppoeServiceName = `${tag}-pppoe`;
  const hotspotGateway = "192.168.180.1";
  const hotspotNetwork = "192.168.180.0/22";
  const hotspotPoolRange = "192.168.180.10-192.168.183.254";
  const pppoeGateway = "192.168.99.1";
  const pppoePoolRange = "192.168.99.10-192.168.99.254";
  const hotspotRows = await runRouterCommand(creds, [
    "/ip/hotspot/print",
    "=.proplist=.id,name,interface,disabled"
  ]);
  const hotspot = (Array.isArray(hotspotRows) ? hotspotRows : []).find((row) => row.name === hotspotName) ?? (Array.isArray(hotspotRows) ? hotspotRows : []).find((row) => row.name === legacy.serverName);
  if (hotspot?.name === legacy.serverName && hotspot[".id"]) {
    const canonicalServer = (Array.isArray(hotspotRows) ? hotspotRows : []).find((row) => row.name === hotspotName);
    if (!canonicalServer) {
      await runRouterCommand(creds, [
        "/ip/hotspot/set",
        `=.id=${hotspot[".id"]}`,
        `=name=${hotspotName}`
      ]);
      hotspot.name = hotspotName;
    }
  }
  const bridgeName = String(hotspot?.interface || "hotspot-bridge").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(bridgeName)) {
    throw new Error("The generated Hotspot has no valid bridge interface.");
  }
  const bridgeRows = await runRouterCommand(creds, [
    "/interface/bridge/print",
    "=.proplist=.id,name,comment",
    `?name=${bridgeName}`
  ]);
  const bridge = (Array.isArray(bridgeRows) ? bridgeRows : []).find((row) => row.name === bridgeName);
  if (!bridge) {
    throw new Error(`The required service bridge "${bridgeName}" was not found on the router.`);
  }
  if (bridgeName === "hotspot-bridge" && String(bridge.comment ?? "").trim()) {
    await runRouterCommand(creds, [
      "/interface/bridge/set",
      `=.id=${bridge[".id"]}`,
      "=comment="
    ]);
  }
  const addressRows = await runRouterCommand(creds, [
    "/ip/address/print",
    "=.proplist=.id,address,interface,comment"
  ]);
  for (const row of (Array.isArray(addressRows) ? addressRows : []).filter((item) => item.comment === `${tag} hotspot gateway`)) {
    if (row[".id"]) await runRouterCommand(creds, ["/ip/address/remove", `=.id=${row[".id"]}`]);
  }
  if (!(Array.isArray(addressRows) ? addressRows : []).some((row) => row.address === `${hotspotGateway}/22` && row.interface === bridgeName)) {
    await runRouterCommand(creds, [
      "/ip/address/add",
      `=address=${hotspotGateway}/22`,
      `=interface=${bridgeName}`,
      `=comment=${tag} hotspot gateway`
    ]);
  }
  const poolRows = await runRouterCommand(creds, [
    "/ip/pool/print",
    "=.proplist=.id,name"
  ]);
  const pool = (Array.isArray(poolRows) ? poolRows : []).find((row) => row.name === hotspotPool) ?? (Array.isArray(poolRows) ? poolRows : []).find((row) => row.name === legacy.poolName);
  if (pool?.name === legacy.poolName && pool[".id"]) {
    const canonicalPool = (Array.isArray(poolRows) ? poolRows : []).find((row) => row.name === hotspotPool);
    if (!canonicalPool) {
      await runRouterCommand(creds, [
        "/ip/pool/set",
        `=.id=${pool[".id"]}`,
        `=name=${hotspotPool}`
      ]);
      pool.name = hotspotPool;
    }
  }
  if (pool?.[".id"]) {
    await runRouterCommand(creds, [
      "/ip/pool/set",
      `=.id=${pool[".id"]}`,
      `=ranges=${hotspotPoolRange}`,
      `=comment=${tag} Hotspot pool`
    ]);
  } else {
    await runRouterCommand(creds, [
      "/ip/pool/add",
      `=name=${hotspotPool}`,
      `=ranges=${hotspotPoolRange}`,
      `=comment=${tag} Hotspot pool`
    ]);
  }
  const dhcpNetworkRows = await runRouterCommand(creds, [
    "/ip/dhcp-server/network/print",
    "=.proplist=.id,address,comment"
  ]);
  for (const row of (Array.isArray(dhcpNetworkRows) ? dhcpNetworkRows : []).filter((item) => item.comment === `${tag} Hotspot DHCP network`)) {
    if (row[".id"]) await runRouterCommand(creds, ["/ip/dhcp-server/network/remove", `=.id=${row[".id"]}`]);
  }
  await runRouterCommand(creds, [
    "/ip/dhcp-server/network/add",
    `=address=${hotspotNetwork}`,
    `=gateway=${hotspotGateway}`,
    `=dns-server=${hotspotGateway},8.8.8.8`,
    `=comment=${tag} Hotspot DHCP network`
  ]);
  const dhcpRows = await runRouterCommand(creds, [
    "/ip/dhcp-server/print",
    "=.proplist=.id,name",
    `?name=${dhcpServer}`
  ]);
  const dhcp = (Array.isArray(dhcpRows) ? dhcpRows : []).find((row) => row.name === dhcpServer);
  if (dhcp?.[".id"]) {
    await runRouterCommand(creds, [
      "/ip/dhcp-server/set",
      `=.id=${dhcp[".id"]}`,
      `=interface=${bridgeName}`,
      `=address-pool=${hotspotPool}`,
      "=disabled=no"
    ]);
  } else {
    await runRouterCommand(creds, [
      "/ip/dhcp-server/add",
      `=name=${dhcpServer}`,
      `=interface=${bridgeName}`,
      `=address-pool=${hotspotPool}`,
      "=disabled=no"
    ]);
  }
  const profileRows = await runRouterCommand(creds, [
    "/ip/hotspot/profile/print",
    "=.proplist=.id,name"
  ]);
  const profile = (Array.isArray(profileRows) ? profileRows : []).find((row) => row.name === hotspotProfile) ?? (Array.isArray(profileRows) ? profileRows : []).find((row) => row.name === "hprofile");
  if (profile?.name === "hprofile" && profile[".id"]) {
    const canonicalProfile = (Array.isArray(profileRows) ? profileRows : []).find((row) => row.name === hotspotProfile);
    if (!canonicalProfile) {
      await runRouterCommand(creds, [
        "/ip/hotspot/profile/set",
        `=.id=${profile[".id"]}`,
        `=name=${hotspotProfile}`
      ]);
      profile.name = hotspotProfile;
    }
  }
  const profileFields = [
    `=hotspot-address=${hotspotGateway}`,
    "=html-directory=hotspot",
    "=login-by=http-chap,http-pap,cookie"
  ];
  if (profile?.[".id"]) {
    await runRouterCommand(creds, ["/ip/hotspot/profile/set", `=.id=${profile[".id"]}`, ...profileFields]);
  } else {
    await runRouterCommand(creds, ["/ip/hotspot/profile/add", `=name=${hotspotProfile}`, ...profileFields]);
  }
  if (hotspot?.[".id"]) {
    await runRouterCommand(creds, [
      "/ip/hotspot/set",
      `=.id=${hotspot[".id"]}`,
      `=interface=${bridgeName}`,
      `=profile=${hotspotProfile}`,
      `=address-pool=${hotspotPool}`
    ]);
  } else {
    await runRouterCommand(creds, [
      "/ip/hotspot/add",
      `=name=${hotspotName}`,
      `=interface=${bridgeName}`,
      `=profile=${hotspotProfile}`,
      `=address-pool=${hotspotPool}`,
      "=disabled=yes"
    ]);
  }
  const pppoePoolRows = await runRouterCommand(creds, [
    "/ip/pool/print",
    "=.proplist=.id,name",
    `?name=${pppoePool}`
  ]);
  const pppoePoolRow = (Array.isArray(pppoePoolRows) ? pppoePoolRows : []).find((row) => row.name === pppoePool);
  if (pppoePoolRow?.[".id"]) {
    await runRouterCommand(creds, [
      "/ip/pool/set",
      `=.id=${pppoePoolRow[".id"]}`,
      `=ranges=${pppoePoolRange}`,
      `=comment=${tag} PPPoE pool`
    ]);
  } else {
    await runRouterCommand(creds, [
      "/ip/pool/add",
      `=name=${pppoePool}`,
      `=ranges=${pppoePoolRange}`,
      `=comment=${tag} PPPoE pool`
    ]);
  }
  const pppoeProfileRows = await runRouterCommand(creds, [
    "/ppp/profile/print",
    "=.proplist=.id,name",
    `?name=${pppoeProfile}`
  ]);
  const pppoeProfileRow = (Array.isArray(pppoeProfileRows) ? pppoeProfileRows : []).find((row) => row.name === pppoeProfile);
  const pppoeProfileFields = [
    `=local-address=${pppoeGateway}`,
    `=remote-address=${pppoePool}`,
    `=dns-server=${hotspotGateway},8.8.8.8`,
    "=only-one=yes",
    "=use-encryption=yes",
    "=change-tcp-mss=yes"
  ];
  if (pppoeProfileRow?.[".id"]) {
    await runRouterCommand(creds, ["/ppp/profile/set", `=.id=${pppoeProfileRow[".id"]}`, ...pppoeProfileFields]);
  } else {
    await runRouterCommand(creds, ["/ppp/profile/add", `=name=${pppoeProfile}`, ...pppoeProfileFields]);
  }
  const pppoeRows = await runRouterCommand(creds, [
    "/interface/pppoe-server/server/print",
    "=.proplist=.id,service-name",
    `?service-name=${pppoeServiceName}`
  ]);
  const pppoe = (Array.isArray(pppoeRows) ? pppoeRows : []).find((row) => row["service-name"] === pppoeServiceName);
  const pppoeFields = [
    `=interface=${bridgeName}`,
    `=default-profile=${pppoeProfile}`,
    "=one-session-per-host=yes",
    "=disabled=no"
  ];
  if (pppoe?.[".id"]) {
    await runRouterCommand(creds, ["/interface/pppoe-server/server/set", `=.id=${pppoe[".id"]}`, ...pppoeFields]);
  } else {
    await runRouterCommand(creds, [
      "/interface/pppoe-server/server/add",
      `=service-name=${pppoeServiceName}`,
      ...pppoeFields
    ]);
  }
  return { bridgeName, hotspotNetwork, pppoeInterface: bridgeName };
}
async function repairGeneratedServiceNetworking(creds, routerId, requestedBridgeName) {
  const tag = `ochola-services-${routerId}`;
  const safeRequestedBridge = String(requestedBridgeName ?? "").trim();
  if (safeRequestedBridge && !/^[A-Za-z0-9_.-]+$/.test(safeRequestedBridge)) {
    throw new Error("The service bridge name is not a valid RouterOS resource name.");
  }
  const hotspotRows = await runRouterCommand(creds, [
    "/ip/hotspot/print",
    "=.proplist=name,interface",
    `?name=${tag}-hotspot`
  ]);
  const hotspot = (Array.isArray(hotspotRows) ? hotspotRows : []).find((row) => row.name === `${tag}-hotspot`);
  const bridgeName = String((hotspot?.interface ?? safeRequestedBridge) || "hotspot-bridge").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(bridgeName)) {
    throw new Error("The router has no valid generated Hotspot bridge name.");
  }
  const bridgeRows = await runRouterCommand(creds, [
    "/interface/bridge/print",
    "=.proplist=name",
    `?name=${bridgeName}`
  ]);
  if (!(Array.isArray(bridgeRows) ? bridgeRows : []).some((row) => row.name === bridgeName)) {
    throw new Error(`The generated service bridge "${bridgeName}" was not found on the router.`);
  }
  const interfaceLists = await runRouterCommand(creds, [
    "/interface/list/print",
    "=.proplist=name"
  ]);
  const listRows = Array.isArray(interfaceLists) ? interfaceLists : [];
  if (!listRows.some((row) => row.name === "LAN")) {
    await runRouterCommand(creds, ["/interface/list/add", "=name=LAN"]);
  }
  const members = await runRouterCommand(creds, [
    "/interface/list/member/print",
    "=.proplist=.id,list,interface"
  ]);
  if (!(Array.isArray(members) ? members : []).some((row) => row.list === "LAN" && row.interface === bridgeName)) {
    await runRouterCommand(creds, [
      "/interface/list/member/add",
      "=list=LAN",
      `=interface=${bridgeName}`
    ]);
  }
  await runRouterCommand(creds, ["/ip/dns/set", "=allow-remote-requests=yes"]);
  const routeRows = await runRouterCommand(creds, [
    "/ip/route/print",
    "=.proplist=dst-address,active,disabled,interface,immediate-gw,gateway"
  ]);
  const defaultRoute = (Array.isArray(routeRows) ? routeRows : []).find(
    (row) => row["dst-address"] === "0.0.0.0/0" && String(row.disabled ?? "").toLowerCase() !== "true" && String(row.active ?? "").toLowerCase() !== "false"
  );
  const immediateGatewayInterface = String(defaultRoute?.["immediate-gw"] ?? "").split("%")[1]?.trim() ?? "";
  const rawEgressInterface = [
    defaultRoute?.interface,
    immediateGatewayInterface,
    defaultRoute?.gateway
  ].map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
  const egressInterface = /^[A-Za-z0-9_.-]+$/.test(rawEgressInterface) ? rawEgressInterface : null;
  const filterRows = await runRouterCommand(creds, [
    "/ip/firewall/filter/print",
    "=.proplist=.id,comment"
  ]);
  const removeTaggedFilters = async (comment) => {
    for (const row of (Array.isArray(filterRows) ? filterRows : []).filter((item) => item.comment === comment)) {
      if (row[".id"]) {
        await runRouterCommand(creds, ["/ip/firewall/filter/remove", `=.id=${row[".id"]}`]);
      }
    }
  };
  const addFilter = async (comment, fields) => {
    await removeTaggedFilters(comment);
    await runRouterCommand(creds, [
      "/ip/firewall/filter/add",
      ...fields,
      `=comment=${comment}`,
      "=place-before=0"
    ]);
  };
  const wanInterfaceListFound = listRows.some((row) => row.name === "WAN");
  const egressField = wanInterfaceListFound ? "=out-interface-list=WAN" : egressInterface ? `=out-interface=${egressInterface}` : null;
  if (egressField) {
    await addFilter(`${tag} service-to-wan`, [
      "=chain=forward",
      "=action=accept",
      `=in-interface=${bridgeName}`,
      egressField,
      "=hotspot=auth",
      "=connection-state=new,established,related"
    ]);
    await addFilter(`${tag} pppoe-to-wan`, [
      "=chain=forward",
      "=action=accept",
      "=src-address=192.168.99.0/24",
      egressField,
      "=connection-state=new,established,related"
    ]);
  }
  await addFilter(`${tag} allow-service-dns-udp`, [
    "=chain=input",
    "=action=accept",
    `=in-interface=${bridgeName}`,
    "=protocol=udp",
    "=dst-port=53"
  ]);
  await addFilter(`${tag} allow-service-dns-tcp`, [
    "=chain=input",
    "=action=accept",
    `=in-interface=${bridgeName}`,
    "=protocol=tcp",
    "=dst-port=53"
  ]);
  if (wanInterfaceListFound) {
    await addFilter(`${tag} block-wan-dns-udp`, [
      "=chain=input",
      "=action=drop",
      "=in-interface-list=WAN",
      "=protocol=udp",
      "=dst-port=53"
    ]);
    await addFilter(`${tag} block-wan-dns-tcp`, [
      "=chain=input",
      "=action=drop",
      "=in-interface-list=WAN",
      "=protocol=tcp",
      "=dst-port=53"
    ]);
  }
  if (egressField) {
    const natRows = await runRouterCommand(creds, [
      "/ip/firewall/nat/print",
      "=.proplist=.id,comment"
    ]);
    const removeTaggedNat = async (comment) => {
      for (const row of (Array.isArray(natRows) ? natRows : []).filter((item) => item.comment === comment)) {
        if (row[".id"]) {
          await runRouterCommand(creds, ["/ip/firewall/nat/remove", `=.id=${row[".id"]}`]);
        }
      }
    };
    for (const [comment, source] of [
      [`${tag} Hotspot masquerade`, "192.168.180.0/22"],
      [`${tag} PPPoE masquerade`, "192.168.99.0/24"]
    ]) {
      await removeTaggedNat(comment);
      await runRouterCommand(creds, [
        "/ip/firewall/nat/add",
        "=chain=srcnat",
        "=action=masquerade",
        `=src-address=${source}`,
        egressField,
        `=comment=${comment}`
      ]);
    }
  }
  return { bridgeName, wanInterfaceListFound, egressInterface, dnsEnabled: true };
}
async function syncHotspotPortalHostname(creds, hostname) {
  return withConn(creds, async (conn, connectedHost) => {
    const timeoutMs = Math.max(creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS, 3e4);
    const profiles = await withTimeout(
      conn.write([
        "/ip/hotspot/profile/print",
        "=.proplist=name,hotspot-address"
      ]),
      timeoutMs
    );
    const rawHotspotAddress = profiles.find((row) => {
      const value = row["hotspot-address"]?.trim() ?? "";
      return value !== "" && value !== "0.0.0.0";
    })?.["hotspot-address"] ?? "";
    const hotspotAddress = rawHotspotAddress.trim().split("/")[0] ?? "";
    logger.info({ rawHotspotAddress, hotspotAddress, hostname }, "Preparing tenant hotspot DNS entry");
    if (!hotspotAddress || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hotspotAddress)) {
      throw new Error("The router has no active hotspot gateway address.");
    }
    const existing = await withTimeout(
      conn.write([
        "/ip/dns/static/print",
        "=.proplist=.id,name"
      ]),
      timeoutMs
    );
    for (const row of Array.isArray(existing) ? existing : []) {
      if (row.name?.toLowerCase() === hostname.toLowerCase() && row[".id"]) {
        await withTimeout(
          conn.write(["/ip/dns/static/remove", `=.id=${row[".id"]}`]),
          timeoutMs
        );
      }
    }
    await withTimeout(
      conn.write([
        "/ip/dns/static/add",
        `=name=${hostname}`,
        `=address=${hotspotAddress}`,
        "=ttl=10s",
        `=comment=tenant portal ${hostname}`
      ]),
      timeoutMs
    );
    const hotspotServers = await withTimeout(
      conn.write([
        "/ip/hotspot/print",
        "=.proplist=.id,name,disabled"
      ]),
      timeoutMs
    );
    const hotspotServer = hotspotServers.find((row) => row.name === SHARED_HOTSPOT_SERVER_NAME && row.disabled !== "true")?.name ?? hotspotServers.find((row) => row.disabled !== "true")?.name ?? "";
    if (!hotspotServer) throw new Error("The router has no enabled hotspot server.");
    const walledGardenRows = await withTimeout(
      conn.write([
        "/ip/hotspot/walled-garden/ip/print",
        "=.proplist=.id,server,dst-host"
      ]),
      timeoutMs
    );
    const allowedHostnames = Array.from(/* @__PURE__ */ new Set([
      hostname.trim().toLowerCase(),
      ...PAYMENT_WALLED_GARDEN_HOSTNAMES
    ]));
    for (const allowedHostname of allowedHostnames) {
      for (const row of Array.isArray(walledGardenRows) ? walledGardenRows : []) {
        if (row["dst-host"]?.toLowerCase() === allowedHostname && row.server === hotspotServer && row[".id"]) {
          await withTimeout(
            conn.write(["/ip/hotspot/walled-garden/ip/remove", `=.id=${row[".id"]}`]),
            timeoutMs
          );
        }
      }
      await withTimeout(
        conn.write([
          "/ip/hotspot/walled-garden/ip/add",
          `=server=${hotspotServer}`,
          `=dst-host=${allowedHostname}`,
          "=action=accept",
          `=comment=${allowedHostname === hostname.trim().toLowerCase() ? `tenant portal ${hostname}` : `payment walled garden ${allowedHostname}`}`
        ]),
        timeoutMs
      );
    }
    return { hostname, hotspotAddress, hotspotServer, connectedHost };
  });
}
async function ensureRouterManagementAccess(creds, routerName) {
  if (!creds.password) throw new Error("The router has no stored management password.");
  const result = await withConn(creds, async (conn, connectedHost) => {
    const timeoutMs = Math.max(creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS, 3e4);
    const managementComment = "DO NOT DELETE - OcholaSupernet management API";
    const routerComment = `DO NOT DELETE - ${routerOsString(routerName)} router management API`;
    const users = await withTimeout(
      conn.write(["/user/print", "=.proplist=.id,name"]),
      timeoutMs
    );
    const desiredUsers = Array.from(new Set(["ocholasupernet", creds.username].filter(Boolean)));
    for (const username of desiredUsers) {
      const existing = users.find((row) => row.name === username)?.[".id"];
      const command = existing ? ["/user/set", `=.id=${existing}`] : ["/user/add", `=name=${username}`];
      command.push(
        `=password=${creds.password}`,
        "=group=full",
        "=disabled=no",
        "=address=",
        `=comment=${username === "ocholasupernet" ? managementComment : routerComment}`
      );
      await withTimeout(conn.write(command), timeoutMs);
    }
    const services = await withTimeout(
      conn.write(["/ip/service/print", "=.proplist=.id,name"]),
      timeoutMs
    );
    for (const service of ["api", "api-ssl"]) {
      const serviceId = services.find((row) => row.name === service)?.[".id"];
      if (!serviceId) continue;
      await withTimeout(
        conn.write([
          "/ip/service/set",
          `=.id=${serviceId}`,
          "=disabled=no",
          "=address=10.8.5.0/24,10.8.6.0/24"
        ]),
        timeoutMs
      );
    }
    const desiredRules = [
      { source: "10.8.5.0/24", comment: "DO NOT DELETE - OcholaSupernet management API" },
      { source: "10.8.6.0/24", comment: "DO NOT DELETE - OcholaSupernet backup management API" }
    ];
    const existingRules = await withTimeout(
      conn.write(["/ip/firewall/filter/print", "=.proplist=.id,comment"]),
      timeoutMs
    );
    let firewallRulesAdded = 0;
    for (const rule of desiredRules) {
      if (existingRules.some((row) => row.comment === rule.comment)) continue;
      await withTimeout(
        conn.write([
          "/ip/firewall/filter/add",
          "=chain=input",
          "=action=accept",
          "=protocol=tcp",
          "=dst-port=8728,8729",
          `=src-address=${rule.source}`,
          `=comment=${rule.comment}`,
          "=place-before=0"
        ]),
        timeoutMs
      );
      firewallRulesAdded++;
    }
    const interfaces = await withTimeout(
      conn.write(["/interface/ovpn-client/print", "=.proplist=.id,name,comment"]),
      timeoutMs
    );
    for (const iface of interfaces) {
      if (iface[".id"] && /mainbillingvpn|ochola.*management|vps tunnel/i.test(iface.comment ?? "")) {
        await withTimeout(
          conn.write([
            "/interface/ovpn-client/set",
            `=.id=${iface[".id"]}`,
            "=comment=DO NOT DELETE - OcholaSupernet management VPN"
          ]),
          timeoutMs
        );
      }
    }
    return { connectedHost, users: desiredUsers, apiPorts: [8728, 8729], firewallRulesAdded };
  });
  const verifiedLoginHost = await withConn(
    { ...creds, username: "ocholasupernet" },
    async (conn, connectedHost) => {
      await withTimeout(
        conn.write(["/system/identity/print", "=.proplist=name"]),
        Math.max(creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS, 3e4)
      );
      return connectedHost;
    }
  );
  return { ...result, verifiedLoginHost };
}
async function probeAllHosts(creds, timeoutMs = 6e3) {
  const hosts = [];
  if (creds.host) hosts.push(creds.host);
  if (creds.bridgeIp && creds.bridgeIp !== creds.host) hosts.push(creds.bridgeIp);
  if (hosts.length === 0) return [];
  return Promise.all(hosts.map((h) => probePort(h, creds.port, timeoutMs)));
}
async function pingRouter(creds) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const caBase = `${ROUTER_HTTPS_CERTIFICATE_NAME}-bootstrap`;
    const caFileName = `${caBase}.txt`;
    const [identRows, resRows] = await Promise.all([
      withTimeout(conn.write(["/system/identity/print"]), ms),
      withTimeout(conn.write(["/system/resource/print"]), ms)
    ]);
    const id = identRows[0] ?? {};
    const res = resRows[0] ?? {};
    return {
      online: true,
      identity: id.name ?? "unknown",
      uptime: res.uptime ?? "",
      version: res.version ?? "",
      board: res["board-name"] ?? res["board"] ?? "",
      cpuLoad: parseInt(res["cpu-load"] ?? "0", 10),
      freeMemory: parseInt(res["free-memory"] ?? "0", 10),
      connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      connectedHost
    };
  });
}
var RouterFileExistsError = class extends Error {
  code = "FILE_EXISTS";
  existingFile;
  constructor(existingFile) {
    super(`A file named "${existingFile.name}" already exists on the router`);
    this.name = "RouterFileExistsError";
    this.existingFile = existingFile;
  }
};
function routerFileFromRow(row) {
  return {
    id: row[".id"] ?? row.name ?? "",
    name: row.name ?? "",
    type: row.type ?? "file",
    size: parseBytes(row.size),
    creationTime: row["creation-time"] ?? ""
  };
}
async function ensureRouterHttpsTrust(creds) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const caBase = `${ROUTER_HTTPS_CERTIFICATE_NAME}-bootstrap`;
    const caFileName = `${caBase}.txt`;
    const certificateRows = await withTimeout(
      conn.write([
        "/certificate/print",
        "=.proplist=.id,name,trusted,flags"
      ]),
      ms
    );
    const current = (Array.isArray(certificateRows) ? certificateRows : []).find((row) => row.name === ROUTER_HTTPS_CERTIFICATE_NAME);
    const trusted = current && (String(current.trusted ?? "").toLowerCase() === "true" || String(current.flags ?? "").toUpperCase().includes("T"));
    if (trusted) return { connectedHost, alreadyTrusted: true };
    if (current?.[".id"]) {
      await withTimeout(conn.write(["/certificate/remove", `=.id=${current[".id"]}`]), ms);
    }
    const fileRows = await withTimeout(
      conn.write([
        "/file/print",
        "=.proplist=.id,name,type,size"
      ]),
      ms
    );
    const oldFiles = (Array.isArray(fileRows) ? fileRows : []).filter((row) => [ROUTER_HTTPS_CERTIFICATE_FILE, `${ROUTER_HTTPS_CERTIFICATE_FILE}.txt`, caFileName].includes(row.name));
    for (const oldFile of oldFiles) {
      if (oldFile[".id"]) {
        await withTimeout(conn.write(["/file/remove", `=.id=${oldFile[".id"]}`]), ms);
      }
    }
    await withTimeout(
      conn.write(["/file/print", `=file=${caBase}`]),
      ms
    );
    const createdRows = await withTimeout(
      conn.write([
        "/file/print",
        "=.proplist=.id,name,type,size"
      ]),
      ms
    );
    const createdFile = (Array.isArray(createdRows) ? createdRows : []).find((row) => row.name === caFileName);
    if (!createdFile?.[".id"]) {
      throw new Error("The router could not create the temporary HTTPS trust file");
    }
    try {
      const lines = ISRG_ROOT_X1_PEM.replace(/\r\n?/g, "\n").split("\n");
      let contents = "";
      for (const [index, line] of lines.entries()) {
        contents += line;
        if (index < lines.length - 1) contents += "\n";
        await withTimeout(
          conn.write([
            "/file/set",
            `=.id=${createdFile[".id"]}`,
            `=contents=${contents}`
          ]),
          Math.max(ms, 3e4)
        );
      }
      await withTimeout(
        conn.write([
          "/certificate/import",
          `=file-name=${createdFile.name}`,
          `=name=${ROUTER_HTTPS_CERTIFICATE_NAME}`,
          "=passphrase="
        ]),
        Math.max(ms, 3e4)
      );
      const importedRows = await withTimeout(
        conn.write([
          "/certificate/print",
          "=.proplist=.id,name,trusted,flags"
        ]),
        ms
      );
      const imported = (Array.isArray(importedRows) ? importedRows : []).find((row) => row.name === ROUTER_HTTPS_CERTIFICATE_NAME);
      if (!imported?.[".id"]) {
        throw new Error("The router did not import the HTTPS trust certificate");
      }
      await withTimeout(
        conn.write(["/certificate/set", `=.id=${imported[".id"]}`, "=trusted=yes"]),
        ms
      );
      const verifiedRows = await withTimeout(
        conn.write([
          "/certificate/print",
          "=.proplist=.id,name,trusted,flags"
        ]),
        ms
      );
      const verified = (Array.isArray(verifiedRows) ? verifiedRows : []).find((row) => row.name === ROUTER_HTTPS_CERTIFICATE_NAME);
      const verifiedTrusted = verified && (String(verified.trusted ?? "").toLowerCase() === "true" || String(verified.flags ?? "").toUpperCase().includes("T"));
      if (!verifiedTrusted) {
        throw new Error("The router imported the HTTPS certificate but did not trust it");
      }
      return { connectedHost, alreadyTrusted: false };
    } finally {
      await withTimeout(
        conn.write(["/file/remove", `=.id=${createdFile[".id"]}`]),
        ms
      ).catch(() => void 0);
    }
  });
}
async function deployRouterFile(creds, options) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const listFiles = async () => {
      const rows = await withTimeout(
        conn.write([
          "/file/print",
          "=.proplist=.id,name,type,size,creation-time"
        ]),
        ms
      );
      return (Array.isArray(rows) ? rows : []).map(routerFileFromRow).filter((file) => file.name.length > 0);
    };
    const existing = (await listFiles()).find((file) => file.name === options.destinationPath);
    if (existing?.type.toLowerCase().includes("directory")) {
      throw new Error(`"${options.destinationPath}" is a directory, not a file`);
    }
    if (existing && !options.overwrite) {
      throw new RouterFileExistsError(existing);
    }
    try {
      await withTimeout(
        conn.write([
          "/tool/fetch",
          `=url=${options.sourceUrl}`,
          `=dst-path=${options.destinationPath}`,
          `=mode=${options.sourceUrl.startsWith("https://") ? "https" : "http"}`,
          ...options.sourceUrl.startsWith("https://") ? ["=check-certificate=yes"] : [],
          "=keep-result=yes"
        ]),
        Math.max(ms, 12e4)
      );
      let transferredFile;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        transferredFile = (await listFiles()).find((file) => file.name === options.destinationPath);
        if (transferredFile) break;
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
      if (!transferredFile) {
        throw new Error("The router did not create the destination upload file");
      }
      return {
        destinationPath: options.destinationPath,
        size: transferredFile.size,
        connectedHost,
        replaced: Boolean(existing)
      };
    } catch (error) {
      throw error;
    }
  });
}
async function fetchRouterFiles(creds) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write([
        "/file/print",
        "=.proplist=.id,name,type,size,creation-time"
      ]),
      ms
    );
    const files = (Array.isArray(rows) ? rows : []).map(routerFileFromRow).filter((file) => file.name.length > 0);
    return { files, connectedHost };
  });
}
function validRouterMac(value) {
  const mac = String(value ?? "").trim();
  return /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac) ? mac.toUpperCase() : "";
}
async function fetchHotspotConnectedDevices(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const byMac = /* @__PURE__ */ new Map();
    const add = (row, source) => {
      const mac = validRouterMac(row["mac-address"]);
      const reportedName = String(
        source === "hotspot" ? row.user ?? row.comment ?? row["host-name"] : row["host-name"] ?? row.comment ?? row.user
      ).trim();
      if (!mac) return;
      const address = String(row.address ?? "").trim();
      const name = (reportedName || `Network device ${mac}`).slice(0, 64);
      if (!byMac.has(mac) || source === "hotspot") {
        byMac.set(mac, { name, macAddress: mac, address, source });
      }
    };
    try {
      const rows = await withTimeout(
        conn.write(["/ip/hotspot/active/print", "=.proplist=user,address,mac-address,comment,host-name"]),
        ms
      );
      for (const row of Array.isArray(rows) ? rows : []) add(row, "hotspot");
    } catch {
    }
    try {
      const rows = await withTimeout(
        conn.write(["/ip/dhcp-server/lease/print", "?status=bound", "=.proplist=host-name,address,mac-address,comment"]),
        ms
      );
      for (const row of Array.isArray(rows) ? rows : []) add(row, "dhcp");
    } catch {
    }
    try {
      const rows = await withTimeout(
        conn.write(["/ip/hotspot/host/print", "=.proplist=address,mac-address,host-name,comment"]),
        ms
      );
      for (const row of Array.isArray(rows) ? rows : []) add(row, "host");
    } catch {
    }
    try {
      const rows = await withTimeout(
        conn.write(["/ip/arp/print", "=.proplist=address,mac-address,interface,complete"]),
        ms
      );
      for (const row of Array.isArray(rows) ? rows : []) add(row, "arp");
    } catch {
    }
    return [...byMac.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}
function parseBytes(val) {
  const n = parseInt(String(val ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}
function parseBool(val) {
  return String(val ?? "false").toLowerCase() !== "false";
}
async function fetchHotspotUsers(creds) {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/ip/hotspot/active/print"]),
      requestMs
    );
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      user: r.user ?? "",
      address: r.address ?? "",
      macAddress: r["mac-address"] ?? "",
      uptime: r.uptime ?? "",
      bytesIn: parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      server: r.server ?? ""
    }));
  });
}
async function resolveHotspotClientMac(creds, clientIp) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(clientIp)) return null;
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const queries = [
      { path: "/ip/hotspot/host/print", macKey: "mac-address" },
      { path: "/ip/dhcp-server/lease/print", macKey: "mac-address" }
    ];
    for (const query of queries) {
      try {
        const rows = await withTimeout(
          conn.write([query.path, `?address=${clientIp}`]),
          ms
        );
        const match = (Array.isArray(rows) ? rows : []).find((row) => row.address === clientIp);
        const rawMac = String(match?.[query.macKey] ?? "").trim();
        if (/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(rawMac)) {
          return rawMac.toUpperCase();
        }
      } catch {
      }
    }
    return null;
  });
}
async function fetchHotspotUserList(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/print"]), ms);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      password: r.password ?? "",
      profile: r.profile ?? "default",
      comment: r.comment ?? "",
      disabled: parseBool(r.disabled),
      limitUptime: r["limit-uptime"] ?? "",
      limitBytesTotal: parseBytes(r["limit-bytes-total"])
    }));
  });
}
async function addHotspotUser(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/hotspot/user/add",
      `=name=${opts.name}`,
      `=password=${opts.password}`,
      `=profile=${opts.profile ?? "default"}`
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    if (opts.server) params.push(`=server=${opts.server}`);
    if (opts.email) params.push(`=email=${opts.email}`);
    if (opts.address) params.push(`=address=${opts.address}`);
    if (opts.limitUptime) params.push(`=limit-uptime=${opts.limitUptime}`);
    if (opts.limitBytesTotal) params.push(`=limit-bytes-total=${opts.limitBytesTotal}`);
    await withTimeout(conn.write(params), ms);
  });
}
function hotspotExpirySchedulerName(name) {
  return `ochola-user-${name.replace(/[^A-Za-z0-9_-]/g, "-").slice(-48)}`;
}
function hotspotPaidExpirySchedulerName(name) {
  return `ochola-paid-${name.replace(/[^A-Za-z0-9_-]/g, "-").slice(-48)}`;
}
function isLegacyPaidHotspotBinding(row) {
  return row.type === "bypassed" && /^(?:OcholaSupernet paid|OcholaSupernet SMS reconnect)\b/i.test(row.comment ?? "");
}
function sameMacAddress(left, right) {
  const normalize = (value) => String(value ?? "").replace(/[:-]/g, "").toUpperCase();
  return normalize(left) === normalize(right);
}
async function removeHotspotIpBinding(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    let rows = await withTimeout(
      conn.write(["/ip/hotspot/ip-binding/print", `?mac-address=${opts.macAddress}`]),
      ms
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      rows = await withTimeout(
        conn.write(["/ip/hotspot/ip-binding/print"]),
        ms
      );
    }
    const bindings = (Array.isArray(rows) ? rows : []).filter(
      (row) => sameMacAddress(row["mac-address"], opts.macAddress) && (row.comment === opts.comment || isLegacyPaidHotspotBinding(row))
    );
    for (const binding of bindings) {
      if (binding[".id"]) {
        await withTimeout(
          conn.write(["/ip/hotspot/ip-binding/remove", `=.id=${binding[".id"]}`]),
          ms
        );
      }
    }
    const schedulerNames = /* @__PURE__ */ new Set([
      hotspotPaidExpirySchedulerName(opts.comment),
      ...bindings.map((binding) => binding.comment).filter((comment) => Boolean(comment)).map(hotspotPaidExpirySchedulerName)
    ]);
    for (const schedulerName of schedulerNames) {
      const schedulers = await withTimeout(
        conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
        ms
      );
      for (const scheduler of Array.isArray(schedulers) ? schedulers : []) {
        if (scheduler[".id"]) {
          await withTimeout(
            conn.write(["/system/scheduler/remove", `=.id=${scheduler[".id"]}`]),
            ms
          );
        }
      }
    }
  });
}
async function removeHotspotUserExpiry(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const schedulerName = hotspotExpirySchedulerName(name);
    const schedulers = await withTimeout(
      conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
      ms
    );
    for (const scheduler of Array.isArray(schedulers) ? schedulers : []) {
      if (scheduler[".id"]) {
        await withTimeout(conn.write(["/system/scheduler/remove", `=.id=${scheduler[".id"]}`]), ms);
      }
    }
  });
}
async function scheduleHotspotUserExpiry(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    if (!Number.isFinite(opts.expiresInSeconds) || opts.expiresInSeconds <= 0) {
      throw new Error("A positive hotspot user duration is required.");
    }
    const clockRows = await withTimeout(
      conn.write(["/system/clock/print"]),
      ms
    );
    const routerNow = parseRouterClock(clockRows[0]?.date, clockRows[0]?.time);
    if (!routerNow) throw new Error("The hotspot router did not provide a usable clock.");
    const expiresAt = new Date(routerNow.getTime() + Math.ceil(opts.expiresInSeconds) * 1e3);
    const schedulerName = hotspotExpirySchedulerName(opts.name);
    const expiryScript = `:foreach id in=[/ip hotspot active find where user="${opts.name}"] do={/ip hotspot active remove $id}; :foreach id in=[/ip hotspot user find where name="${opts.name}"] do={/ip hotspot user set $id disabled=yes}; :foreach id in=[/ip hotspot ip-binding find where comment="${opts.name}"] do={/ip hotspot ip-binding remove $id}; :foreach id in=[/queue simple find where name="${hotspotRateQueueName(opts.name)}"] do={/queue simple remove $id}; /system scheduler remove [find where name="${schedulerName}"]`;
    const schedulers = await withTimeout(
      conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
      ms
    );
    const schedulerCommand = schedulers[0]?.[".id"] ? ["/system/scheduler/set", `=.id=${schedulers[0][".id"]}`] : ["/system/scheduler/add", `=name=${schedulerName}`];
    schedulerCommand.push(
      `=start-date=${formatRouterDate(expiresAt)}`,
      `=start-time=${formatRouterTime(expiresAt)}`,
      "=interval=00:00:00",
      "=disabled=no",
      `=on-event=${expiryScript}`,
      "=comment=OcholaSupernet hotspot user expiry"
    );
    await withTimeout(conn.write(schedulerCommand), ms);
  });
}
async function reconcileHotspotUserAccess(creds, opts) {
  const expiryMs = opts.expiresAt ? Date.parse(opts.expiresAt) : NaN;
  const expired = Number.isFinite(expiryMs) && expiryMs <= Date.now();
  const enabled = opts.enabled && !expired;
  const fields = {
    password: opts.password,
    profile: opts.profile,
    disabled: !enabled,
    ...opts.address ? { address: opts.address } : {},
    ...opts.comment !== void 0 ? { comment: opts.comment } : {},
    ...opts.limitBytesTotal !== void 0 ? { limitBytesTotal: opts.limitBytesTotal } : {}
  };
  await requireHotspotUserProfile(creds, opts.profile);
  try {
    await updateHotspotUser(creds, opts.name, fields);
  } catch {
    await addHotspotUser(creds, {
      name: opts.name,
      password: opts.password,
      profile: opts.profile,
      comment: opts.comment,
      address: opts.address ?? void 0,
      limitBytesTotal: opts.limitBytesTotal
    });
    if (!enabled) await updateHotspotUser(creds, opts.name, { disabled: true });
  }
  if (!enabled) {
    await disconnectHotspotActiveUser(creds, opts.name).catch(() => {
    });
    await removeHotspotUserRateQueue(creds, opts.name).catch(() => {
    });
    await removeHotspotUserExpiry(creds, opts.name).catch(() => {
    });
    if (opts.macAddress) {
      await removeHotspotIpBinding(creds, {
        macAddress: opts.macAddress,
        comment: opts.name
      });
    }
    return;
  }
  if (opts.limitBytesTotal !== void 0) {
    await resetHotspotUserCounters(creds, opts.name).catch(() => {
    });
  }
  if (opts.address && opts.rateLimit) {
    await ensureHotspotUserRateQueue(creds, {
      username: opts.name,
      address: opts.address,
      maxLimit: opts.rateLimit
    });
  }
  await disconnectHotspotActiveUser(creds, opts.name);
  if (Number.isFinite(expiryMs)) {
    await scheduleHotspotUserExpiry(creds, {
      name: opts.name,
      expiresInSeconds: Math.max(1, Math.ceil((expiryMs - Date.now()) / 1e3))
    });
  } else {
    await removeHotspotUserExpiry(creds, opts.name);
  }
}
function pppExpirySchedulerName(name) {
  return `ochola-ppp-${name.replace(/[^A-Za-z0-9_-]/g, "-").slice(-48)}`;
}
async function removePppUserExpiry(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const schedulerName = pppExpirySchedulerName(name);
    const schedulers = await withTimeout(
      conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
      ms
    );
    for (const scheduler of Array.isArray(schedulers) ? schedulers : []) {
      if (scheduler[".id"]) {
        await withTimeout(conn.write(["/system/scheduler/remove", `=.id=${scheduler[".id"]}`]), ms);
      }
    }
  });
}
async function schedulePppUserExpiry(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    if (!Number.isFinite(opts.expiresInSeconds) || opts.expiresInSeconds <= 0) {
      throw new Error("A positive PPP user duration is required.");
    }
    const clockRows = await withTimeout(conn.write(["/system/clock/print"]), ms);
    const routerNow = parseRouterClock(clockRows[0]?.date, clockRows[0]?.time);
    if (!routerNow) throw new Error("The PPP router did not provide a usable clock.");
    const expiresAt = new Date(routerNow.getTime() + Math.ceil(opts.expiresInSeconds) * 1e3);
    const schedulerName = pppExpirySchedulerName(opts.name);
    const expiryScript = `:foreach id in=[/ppp active find where name="${opts.name}"] do={/ppp active remove $id}; :foreach id in=[/ppp secret find where name="${opts.name}"] do={/ppp secret set $id disabled=yes}; /system scheduler remove [find where name="${schedulerName}"]`;
    const schedulers = await withTimeout(
      conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
      ms
    );
    const command = schedulers[0]?.[".id"] ? ["/system/scheduler/set", `=.id=${schedulers[0][".id"]}`] : ["/system/scheduler/add", `=name=${schedulerName}`];
    command.push(
      `=start-date=${formatRouterDate(expiresAt)}`,
      `=start-time=${formatRouterTime(expiresAt)}`,
      "=interval=00:00:00",
      "=disabled=no",
      `=on-event=${expiryScript}`,
      "=comment=OcholaSupernet PPP user expiry"
    );
    await withTimeout(conn.write(command), ms);
  });
}
async function reconcilePppoeUserAccess(creds, opts) {
  const expiryMs = opts.expiresAt ? Date.parse(opts.expiresAt) : NaN;
  const expired = Number.isFinite(expiryMs) && expiryMs <= Date.now();
  const enabled = opts.enabled && !expired;
  const secrets = await fetchPPPSecrets(creds);
  const existing = secrets.find((secret) => secret.name === opts.name);
  if (existing?.id) {
    await updatePPPSecret(creds, existing.id, {
      password: opts.password,
      profile: opts.profile,
      disabled: !enabled,
      comment: opts.comment,
      ...opts.remoteAddress !== void 0 && opts.remoteAddress !== null ? { remoteAddress: opts.remoteAddress } : {}
    });
  } else {
    await addPPPSecret(creds, {
      name: opts.name,
      password: opts.password,
      profile: opts.profile,
      service: "pppoe",
      comment: opts.comment,
      ...opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}
    });
    if (!enabled) {
      const created = (await fetchPPPSecrets(creds)).find((secret) => secret.name === opts.name);
      if (created?.id) await updatePPPSecret(creds, created.id, { disabled: true });
    }
  }
  await disconnectPPPActiveByName(creds, opts.name).catch(() => {
  });
  if (!enabled) {
    await removePppUserExpiry(creds, opts.name).catch(() => {
    });
  } else if (Number.isFinite(expiryMs)) {
    await schedulePppUserExpiry(creds, {
      name: opts.name,
      expiresInSeconds: Math.max(1, Math.ceil((expiryMs - Date.now()) / 1e3))
    });
  } else {
    await removePppUserExpiry(creds, opts.name);
  }
}
async function removeHotspotUser(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ip/hotspot/user/remove", `=.id=${id}`]), ms);
  });
}
async function updateHotspotUser(creds, name, fields) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`Hotspot user '${name}' not found`);
    const params = ["/ip/hotspot/user/set", `=.id=${id}`];
    if (fields.password !== void 0) params.push(`=password=${fields.password}`);
    if (fields.profile !== void 0) params.push(`=profile=${fields.profile}`);
    if (fields.disabled !== void 0) params.push(`=disabled=${fields.disabled ? "yes" : "no"}`);
    if (fields.comment !== void 0) params.push(`=comment=${fields.comment}`);
    if (fields.server !== void 0) params.push(`=server=${fields.server}`);
    if (fields.email !== void 0) params.push(`=email=${fields.email}`);
    if (fields.address !== void 0) params.push(`=address=${fields.address}`);
    if (fields.limitUptime !== void 0) params.push(`=limit-uptime=${fields.limitUptime}`);
    if (fields.limitBytesTotal !== void 0) params.push(`=limit-bytes-total=${fields.limitBytesTotal}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function resetHotspotUserCounters(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/ip/hotspot/user/print", `?name=${name}`]),
      ms
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row[".id"]) {
        await withTimeout(
          conn.write(["/ip/hotspot/user/reset-counters", `=.id=${row[".id"]}`]),
          ms
        );
      }
    }
  });
}
async function changeHotspotUsername(creds, fromName, toName) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/print", `?name=${fromName}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`Hotspot user '${fromName}' not found`);
    await withTimeout(conn.write(["/ip/hotspot/user/set", `=.id=${id}`, `=name=${toName}`]), ms);
    await disconnectHotspotActiveUser(creds, fromName).catch(() => {
    });
  });
}
async function disconnectHotspotActiveUser(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/active/print", `?user=${username}`]), ms);
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = row[".id"];
      if (id) await withTimeout(conn.write(["/ip/hotspot/active/remove", `=.id=${id}`]), ms);
    }
  });
}
async function connectHotspotUser(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const command = [
      "/ip/hotspot/active/login",
      `=user=${opts.user}`,
      `=password=${opts.password}`,
      `=ip=${opts.ip}`,
      `=mac-address=${opts.macAddress}`
    ];
    if (opts.server) command.push(`=server=${opts.server}`);
    await withTimeout(conn.write(command), ms);
  });
}
async function addHotspotIpBinding(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const existing = await withTimeout(
      conn.write(["/ip/hotspot/ip-binding/print", `?mac-address=${opts.macAddress}`]),
      ms
    );
    const paidBinding = existing.find((row) => row.comment === opts.comment) ?? existing.find(
      (row) => row.type === "bypassed" && /^(?:OcholaSupernet paid|OcholaSupernet SMS reconnect)\b/i.test(row.comment ?? "")
    );
    if (!paidBinding && existing.some((row) => row.type === "bypassed")) return false;
    if (!Number.isFinite(opts.expiresInSeconds) || opts.expiresInSeconds <= 0) {
      throw new Error("A positive hotspot access duration is required.");
    }
    const clockRows = await withTimeout(
      conn.write(["/system/clock/print"]),
      ms
    );
    const routerNow = parseRouterClock(clockRows[0]?.date, clockRows[0]?.time);
    if (!routerNow) throw new Error("The hotspot router did not provide a usable clock.");
    const expiresAt = new Date(routerNow.getTime() + Math.ceil(opts.expiresInSeconds) * 1e3);
    const schedulerName = hotspotPaidExpirySchedulerName(opts.comment);
    const queueName = opts.queueName ?? hotspotRateQueueName(opts.comment);
    const queueExpiry = queueName ? `:foreach id in=[/queue simple find where name="${queueName}"] do={/queue simple remove $id}; ` : "";
    const expiryScript = `:foreach id in=[/ip hotspot ip-binding find where comment="${opts.comment}"] do={/ip hotspot ip-binding remove $id}; :foreach id in=[/ip hotspot active find where user="${opts.comment}"] do={/ip hotspot active remove $id}; :foreach id in=[/ip hotspot user find where name="${opts.comment}"] do={/ip hotspot user set $id disabled=yes}; ` + queueExpiry + `/system scheduler remove [find where name="${schedulerName}"]`;
    const schedulers = await withTimeout(
      conn.write(["/system/scheduler/print", `?name=${schedulerName}`]),
      ms
    );
    const schedulerCommand = schedulers[0]?.[".id"] ? ["/system/scheduler/set", `=.id=${schedulers[0][".id"]}`] : ["/system/scheduler/add", `=name=${schedulerName}`];
    schedulerCommand.push(
      `=start-date=${formatRouterDate(expiresAt)}`,
      `=start-time=${formatRouterTime(expiresAt)}`,
      "=interval=00:00:00",
      `=on-event=${expiryScript}`,
      `=comment=OcholaSupernet paid access expiry`
    );
    await withTimeout(conn.write(schedulerCommand), ms);
    try {
      const id = paidBinding?.[".id"];
      const params = id ? ["/ip/hotspot/ip-binding/set", `=.id=${id}`] : ["/ip/hotspot/ip-binding/add", `=mac-address=${opts.macAddress}`];
      params.push(`=type=${opts.bindingType ?? "bypassed"}`, `=comment=${opts.comment}`);
      if (opts.ipAddress) params.push(`=address=${opts.ipAddress}`);
      await withTimeout(conn.write(params), ms);
    } catch (error) {
      const schedulerId = schedulers[0]?.[".id"];
      if (schedulerId) {
        const previous = schedulers[0];
        const restore = ["/system/scheduler/set", `=.id=${schedulerId}`];
        for (const field of ["start-date", "start-time", "interval", "on-event", "comment"]) {
          if (previous[field]) restore.push(`=${field}=${previous[field]}`);
        }
        await withTimeout(conn.write(restore), ms).catch(() => void 0);
      } else {
        await withTimeout(conn.write(["/system/scheduler/print", `?name=${schedulerName}`]), ms).then((rows) => {
          const id = rows[0]?.[".id"];
          return id ? conn.write(["/system/scheduler/remove", `=.id=${id}`]) : void 0;
        }).catch(() => void 0);
      }
      throw error;
    }
    return true;
  });
}
function hotspotRateQueueName(username) {
  return `ochola-rate-${username.replace(/[^A-Za-z0-9_-]/g, "-").slice(-52)}`;
}
async function ensureHotspotUserRateQueue(creds, opts) {
  const address = opts.address;
  if (!address || !opts.maxLimit) return;
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const name = hotspotRateQueueName(opts.username);
    const target = address.includes("/") ? address : `${address}/32`;
    const rows = await withTimeout(
      conn.write(["/queue/simple/print", `?name=${name}`]),
      ms
    );
    const existing = Array.isArray(rows) ? rows[0] : void 0;
    const command = existing?.[".id"] ? ["/queue/simple/set", `=.id=${existing[".id"]}`] : ["/queue/simple/add", `=name=${name}`];
    command.push(
      `=target=${target}`,
      `=max-limit=${opts.maxLimit}`,
      `=comment=${opts.username}`,
      "=disabled=no"
    );
    await withTimeout(conn.write(command), ms);
  });
}
async function removeHotspotUserRateQueue(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const name = hotspotRateQueueName(username);
    const rows = await withTimeout(
      conn.write(["/queue/simple/print", `?name=${name}`]),
      ms
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row[".id"]) {
        await withTimeout(conn.write(["/queue/simple/remove", `=.id=${row[".id"]}`]), ms);
      }
    }
  });
}
function parseRouterClock(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const slashDate = /^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i.exec(dateValue.trim());
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const dateParts = slashDate ? { year: Number(slashDate[3]), month: MONTH_NAMES.indexOf(slashDate[1].toLowerCase()), day: Number(slashDate[2]) } : isoDate ? { year: Number(isoDate[1]), month: Number(isoDate[2]) - 1, day: Number(isoDate[3]) } : null;
  const timeParts = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!dateParts || !timeParts || dateParts.month < 0 || dateParts.day < 1) return null;
  return new Date(Date.UTC(dateParts.year, dateParts.month, dateParts.day, Number(timeParts[1]), Number(timeParts[2]), Number(timeParts[3])));
}
function formatRouterDate(value) {
  return `${MONTH_NAMES[value.getUTCMonth()]}/${String(value.getUTCDate()).padStart(2, "0")}/${value.getUTCFullYear()}`;
}
function formatRouterTime(value) {
  return [value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}
var MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
async function isHotspotUserOnline(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/active/print", `?user=${username}`]), ms);
    return rows.length > 0 && !!rows[0]?.[".id"];
  });
}
async function getHotspotUserIp(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/active/print", `?user=${username}`]), ms);
    return rows[0]?.address ?? null;
  });
}
async function addHotspotUserProfile(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/hotspot/user/profile/add",
      `=name=${opts.name}`,
      `=shared-users=${opts.sharedUsers ?? 1}`
    ];
    if (opts.rateLimit) params.push(`=rate-limit=${opts.rateLimit}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function ensureHotspotUserProfile(creds, opts) {
  try {
    await updateHotspotUserProfile(creds, opts.name, {
      sharedUsers: opts.sharedUsers,
      rateLimit: opts.rateLimit
    });
  } catch {
    try {
      await addHotspotUserProfile(creds, opts);
    } catch {
      await updateHotspotUserProfile(creds, opts.name, {
        sharedUsers: opts.sharedUsers,
        rateLimit: opts.rateLimit
      });
    }
  }
}
async function requireHotspotUserProfile(creds, name) {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("The hotspot plan has no RouterOS profile name");
  await withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/ip/hotspot/user/profile/print", `?name=${normalizedName}`]),
      ms
    );
    if (!Array.isArray(rows) || !rows.some((row) => row[".id"])) {
      throw new Error(
        `Hotspot plan profile '${normalizedName}' does not exist on this router. Sync the created plan before provisioning paid users.`
      );
    }
  });
}
async function updateHotspotUserProfile(creds, name, fields) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/profile/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`Hotspot profile '${name}' not found`);
    const params = ["/ip/hotspot/user/profile/set", `=.id=${id}`];
    if (fields.newName !== void 0) params.push(`=name=${fields.newName}`);
    if (fields.sharedUsers !== void 0) params.push(`=shared-users=${fields.sharedUsers}`);
    if (fields.rateLimit !== void 0) params.push(`=rate-limit=${fields.rateLimit}`);
    if (fields.onLogin !== void 0) params.push(`=on-login=${fields.onLogin}`);
    if (fields.onLogout !== void 0) params.push(`=on-logout=${fields.onLogout}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removeHotspotUserProfile(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/hotspot/user/profile/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ip/hotspot/user/profile/remove", `=.id=${id}`]), ms);
  });
}
async function fetchWireless(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const [ifaceRows, profileRows] = await Promise.all([
      withTimeout(conn.write(["/interface/wireless/print"]), ms),
      withTimeout(conn.write(["/interface/wireless/security-profiles/print"]), ms)
    ]);
    const interfaces = (Array.isArray(ifaceRows) ? ifaceRows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      ssid: r.ssid ?? "",
      disabled: parseBool(r.disabled),
      band: r.band ?? "",
      channel: r.channel ?? "",
      macAddress: r["mac-address"] ?? "",
      securityProfile: r["security-profile"] ?? "default",
      mode: r.mode ?? ""
    }));
    const profiles = (Array.isArray(profileRows) ? profileRows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      wpa2PreSharedKey: r["wpa2-pre-shared-key"] ?? "",
      authentication: r["authentication-types"] ?? ""
    }));
    return { interfaces, profiles };
  });
}
async function setWirelessInterface(creds, interfaceId, params) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd = ["/interface/wireless/set", `=.id=${interfaceId}`];
    if (params.ssid !== void 0) cmd.push(`=ssid=${params.ssid}`);
    await withTimeout(conn.write(cmd), ms);
  });
}
async function setWirelessSecurityProfile(creds, profileId, params) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd = ["/interface/wireless/security-profiles/set", `=.id=${profileId}`];
    if (params.password !== void 0) cmd.push(`=wpa2-pre-shared-key=${params.password}`);
    await withTimeout(conn.write(cmd), ms);
  });
}
async function fetchPPPoEActive(creds) {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    );
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      address: r.address ?? "",
      uptime: r.uptime ?? "",
      bytesIn: parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      service: r.service ?? ""
    }));
  });
}
async function fetchPPPSecrets(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/secret/print"]), ms);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      password: r.password ?? "",
      service: r.service ?? "any",
      profile: r.profile ?? "default",
      localAddress: r["local-address"] ?? "",
      remoteAddress: r["remote-address"] ?? "",
      disabled: parseBool(r.disabled),
      comment: r.comment ?? ""
    }));
  });
}
async function addPPPSecret(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ppp/secret/add",
      `=name=${opts.name}`,
      `=password=${opts.password}`,
      `=service=${opts.service ?? "any"}`,
      `=profile=${opts.profile ?? "default"}`
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    if (opts.localAddress) params.push(`=local-address=${opts.localAddress}`);
    if (opts.remoteAddress) params.push(`=remote-address=${opts.remoteAddress}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removePPPSecret(creds, id) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/secret/remove", `=.id=${id}`]), ms);
  });
}
async function removePPPSecretByName(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/secret/print", `?name=${username}`]), ms);
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ppp/secret/remove", `=.id=${id}`]), ms);
    }
  });
}
async function updatePPPSecret(creds, id, fields) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = ["/ppp/secret/set", `=.id=${id}`];
    if (fields.name !== void 0) params.push(`=name=${fields.name}`);
    if (fields.password !== void 0) params.push(`=password=${fields.password}`);
    if (fields.profile !== void 0) params.push(`=profile=${fields.profile}`);
    if (fields.disabled !== void 0) params.push(`=disabled=${fields.disabled ? "yes" : "no"}`);
    if (fields.comment !== void 0) params.push(`=comment=${fields.comment}`);
    if (fields.service !== void 0) params.push(`=service=${fields.service}`);
    if (fields.localAddress !== void 0) params.push(`=local-address=${fields.localAddress}`);
    if (fields.remoteAddress !== void 0) params.push(`=remote-address=${fields.remoteAddress}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function changePPPSecretName(creds, fromName, toName) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/secret/print", `?name=${fromName}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`PPP secret '${fromName}' not found`);
    await withTimeout(conn.write(["/ppp/secret/set", `=.id=${id}`, `=name=${toName}`]), ms);
    await disconnectPPPActiveByName(creds, fromName).catch(() => {
    });
  });
}
async function disconnectPPPActive(creds, id) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/active/remove", `=.id=${id}`]), ms);
  });
}
async function disconnectPPPActiveByName(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/active/print", `?name=${username}`]), ms);
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ppp/active/remove", `=.id=${id}`]), ms);
  });
}
async function isPPPUserOnline(creds, username) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/active/print", `?name=${username}`]), ms);
    return rows.length > 0 && !!rows[0]?.[".id"];
  });
}
async function fetchPPPProfiles(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/profile/print"]), ms);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      localAddress: r["local-address"] ?? "",
      remoteAddress: r["remote-address"] ?? "",
      rateLimit: r["rate-limit"] ?? "",
      sessionTimeout: r["session-timeout"] ?? "",
      idleTimeout: r["idle-timeout"] ?? "",
      comment: r.comment ?? ""
    }));
  });
}
async function addPPPProfile(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = ["/ppp/profile/add", `=name=${opts.name}`];
    if (opts.localAddress) params.push(`=local-address=${opts.localAddress}`);
    if (opts.remoteAddress) params.push(`=remote-address=${opts.remoteAddress}`);
    if (opts.rateLimit) params.push(`=rate-limit=${opts.rateLimit}`);
    if (opts.onUp) params.push(`=on-up=${opts.onUp}`);
    if (opts.onDown) params.push(`=on-down=${opts.onDown}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function updatePPPProfile(creds, name, fields) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/profile/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`PPP profile '${name}' not found`);
    const params = ["/ppp/profile/set", `=.id=${id}`];
    if (fields.newName !== void 0) params.push(`=name=${fields.newName}`);
    if (fields.localAddress !== void 0) params.push(`=local-address=${fields.localAddress}`);
    if (fields.remoteAddress !== void 0) params.push(`=remote-address=${fields.remoteAddress}`);
    if (fields.rateLimit !== void 0) params.push(`=rate-limit=${fields.rateLimit}`);
    if (fields.onUp !== void 0) params.push(`=on-up=${fields.onUp}`);
    if (fields.onDown !== void 0) params.push(`=on-down=${fields.onDown}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removePPPProfile(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ppp/profile/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ppp/profile/remove", `=.id=${id}`]), ms);
  });
}
async function fetchIpPools(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/pool/print"]), ms);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      ranges: r.ranges ?? "",
      comment: r.comment ?? ""
    }));
  });
}
async function addIpPool(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = ["/ip/pool/add", `=name=${opts.name}`, `=ranges=${opts.ranges}`];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function updateIpPool(creds, name, fields) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/pool/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`IP pool '${name}' not found`);
    const params = ["/ip/pool/set", `=.id=${id}`];
    if (fields.newName !== void 0) params.push(`=name=${fields.newName}`);
    if (fields.ranges !== void 0) params.push(`=ranges=${fields.ranges}`);
    if (fields.comment !== void 0) params.push(`=comment=${fields.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removeIpPool(creds, name) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/pool/print", `?name=${name}`]), ms);
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ip/pool/remove", `=.id=${id}`]), ms);
  });
}
async function addIpToAddressList(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/firewall/address-list/add",
      `=address=${opts.address}`,
      `=list=${opts.list}`
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removeIpFromAddressList(creds, address) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/firewall/address-list/print", `?address=${address}`]), ms);
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ip/firewall/address-list/remove", `=.id=${id}`]), ms);
    }
  });
}
async function addDstNatRule(creds, opts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/firewall/nat/add",
      "=chain=dstnat",
      `=protocol=${opts.protocol ?? "tcp"}`,
      `=dst-port=${opts.dstPort}`,
      "=action=dst-nat",
      `=to-addresses=${opts.toAddresses}`,
      `=to-ports=${opts.toPorts}`,
      `=dst-address=${opts.dstAddress}`
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}
async function removeDstNatByAddress(creds, toAddress) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(conn.write(["/ip/firewall/nat/print", `?to-addresses=${toAddress}`]), ms);
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ip/firewall/nat/remove", `=.id=${id}`]), ms);
    }
  });
}
async function fetchInterfaces(creds) {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    );
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      type: r.type ?? "",
      running: parseBool(r.running),
      disabled: parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment: r.comment ?? "",
      txBps: parseBytes(r["tx-byte"]),
      rxBps: parseBytes(r["rx-byte"])
    }));
  });
}
async function fetchTraffic(creds, interfaces = []) {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    let ifaceNames = interfaces;
    if (ifaceNames.length === 0) {
      const rows = await withTimeout(
        conn.write(["/interface/print"]),
        requestMs
      );
      ifaceNames = (Array.isArray(rows) ? rows : []).filter((r) => parseBool(r.running) && !parseBool(r.disabled)).map((r) => r.name).filter(Boolean).slice(0, 8);
    }
    if (ifaceNames.length === 0) return [];
    const samples = await withTimeout(
      conn.write([
        "/interface/monitor-traffic",
        `=interface=${ifaceNames.join(",")}`,
        "=once="
      ]),
      requestMs
    );
    return (Array.isArray(samples) ? samples : []).map((s, i) => ({
      iface: s.name ?? ifaceNames[i] ?? `iface${i}`,
      rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
      txBitsPerSecond: parseBytes(s["tx-bits-per-second"])
    }));
  });
}
async function fetchRouterLiveData(creds) {
  const usingSSL = creds.useSSL ?? creds.port === 8729;
  const { conn, connectedHost } = await connectWithRetry(creds);
  const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
  try {
    const hotspotRows = await withTimeout(
      conn.write(["/ip/hotspot/active/print"]),
      requestMs
    ).catch((e) => {
      logger.warn({ err: e.message }, "hotspot fetch failed");
      return [];
    });
    const pppoeRows = await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    ).catch((e) => {
      logger.warn({ err: e.message }, "pppoe fetch failed");
      return [];
    });
    const ifaceRows = await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    ).catch((e) => {
      logger.warn({ err: e.message }, "interface fetch failed");
      return [];
    });
    const interfaces = (Array.isArray(ifaceRows) ? ifaceRows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      type: r.type ?? "",
      running: parseBool(r.running),
      disabled: parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment: r.comment ?? "",
      txBps: parseBytes(r["tx-byte"]),
      rxBps: parseBytes(r["rx-byte"])
    }));
    const runningIfaces = interfaces.filter((i) => i.running && !i.disabled).map((i) => i.name).slice(0, 8);
    let traffic = [];
    if (runningIfaces.length > 0) {
      const samples = await withTimeout(
        conn.write([
          "/interface/monitor-traffic",
          `=interface=${runningIfaces.join(",")}`,
          "=once="
        ]),
        requestMs
      ).catch((e) => {
        logger.warn({ err: e.message }, "traffic fetch failed");
        return [];
      });
      traffic = (Array.isArray(samples) ? samples : []).map((s, i) => ({
        iface: s.name ?? runningIfaces[i] ?? `iface${i}`,
        rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
        txBitsPerSecond: parseBytes(s["tx-bits-per-second"])
      }));
    }
    return {
      hotspotUsers: (Array.isArray(hotspotRows) ? hotspotRows : []).map((r) => ({
        id: r[".id"] ?? "",
        user: r.user ?? "",
        address: r.address ?? "",
        macAddress: r["mac-address"] ?? "",
        uptime: r.uptime ?? "",
        bytesIn: parseBytes(r["bytes-in"]),
        bytesOut: parseBytes(r["bytes-out"]),
        server: r.server ?? ""
      })),
      pppoeUsers: (Array.isArray(pppoeRows) ? pppoeRows : []).map((r) => ({
        id: r[".id"] ?? "",
        name: r.name ?? "",
        address: r.address ?? "",
        uptime: r.uptime ?? "",
        bytesIn: parseBytes(r["bytes-in"]),
        bytesOut: parseBytes(r["bytes-out"]),
        service: r.service ?? ""
      })),
      interfaces,
      traffic,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      usingSSL,
      connectedHost
    };
  } finally {
    try {
      conn.close();
    } catch {
    }
  }
}
async function detectBridgeInterfaces(creds) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = await withTimeout(
      conn.write(["/interface/bridge/print"]),
      ms
    );
    const names = rows.map((r) => r.name).filter(Boolean);
    const best = names.find((n) => n === "hotspot-bridge") ?? names.find((n) => n.toLowerCase().includes("hotspot")) ?? names.find((n) => n.toLowerCase().includes("bridge")) ?? names[0] ?? null;
    return { bridgeInterfaces: names, detectedBridgeInterface: best };
  });
}
async function testConnection(creds) {
  const warnings = [];
  if (creds.host && isPrivateIp(creds.host)) {
    warnings.push(
      `Host ${creds.host} is a private/local IP. This will only work if the VPS is on the same LAN. For remote access, use the router's public IP or configure the router-management VPN and set vpn_ip.`
    );
  }
  if (!creds.host && creds.bridgeIp) {
    warnings.push(
      `No public host configured \u2014 will attempt via VPN tunnel IP ${creds.bridgeIp} only.`
    );
  }
  const probeMs = Math.min(creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS, 6e3);
  const portProbes = await probeAllHosts(creds, probeMs);
  for (const p of portProbes) {
    if (p.reachable) {
      logger.info(
        { host: p.host, port: p.port, latencyMs: p.latencyMs },
        "Port probe: OPEN"
      );
    } else {
      logger.warn(
        { host: p.host, port: p.port, error: p.error, diagnosis: p.diagnosis },
        "Port probe: BLOCKED"
      );
      warnings.push(`${p.host}:${p.port} \u2014 ${p.diagnosis ?? p.error ?? "unreachable"}`);
    }
  }
  const anyPortOpen = portProbes.some((p) => p.reachable);
  if (!anyPortOpen && portProbes.length > 0) {
    const totalMs = portProbes.reduce((s, p) => s + p.latencyMs, 0);
    return {
      ok: false,
      connectedHost: "",
      method: "failed",
      latencyMs: totalMs,
      usingSSL: creds.useSSL ?? creds.port === 8729,
      error: `API port ${creds.port} is not reachable on any configured host. Check firewall rules, NAT port-forwarding, and that the API service is enabled on the router (/ip service enable api).`,
      warnings,
      portProbes
    };
  }
  const start = Date.now();
  try {
    const { conn, connectedHost } = await connectWithRetry(creds);
    const latencyMs = Date.now() - start;
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    let routerIdentity;
    let rosVersion;
    let model;
    let bridgeInterfaces = [];
    let detectedBridgeInterface;
    const [identResult, resourceResult, bridgeResult, routerboardResult] = await Promise.allSettled([
      withTimeout(conn.write(["/system/identity/print"]), ms),
      withTimeout(conn.write(["/system/resource/print"]), ms),
      withTimeout(conn.write(["/interface/bridge/print"]), ms),
      withTimeout(conn.write(["/system/routerboard/print"]), ms)
    ]);
    const identRows = identResult.status === "fulfilled" ? identResult.value : [];
    const resourceRows = resourceResult.status === "fulfilled" ? resourceResult.value : [];
    const bridgeRows = bridgeResult.status === "fulfilled" ? bridgeResult.value : [];
    const routerboardRows = routerboardResult.status === "fulfilled" ? routerboardResult.value : [];
    routerIdentity = identRows[0]?.name;
    rosVersion = resourceRows[0]?.version;
    model = routerboardRows[0]?.model || routerboardRows[0]?.["board-name"] || resourceRows[0]?.["board-name"];
    bridgeInterfaces = bridgeRows.map((r) => r.name).filter(Boolean);
    detectedBridgeInterface = bridgeInterfaces.find((n) => n === "hotspot-bridge") ?? bridgeInterfaces.find((n) => n.toLowerCase().includes("hotspot")) ?? bridgeInterfaces.find((n) => n.toLowerCase().includes("bridge")) ?? bridgeInterfaces[0];
    try {
      conn.close();
    } catch {
    }
    const method = connectedHost === creds.bridgeIp ? "vpn-tunnel" : "public-ip";
    return {
      ok: true,
      connectedHost,
      method,
      latencyMs,
      usingSSL: creds.useSSL ?? creds.port === 8729,
      warnings,
      portProbes,
      routerIdentity,
      rosVersion,
      model,
      bridgeInterfaces,
      detectedBridgeInterface
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      connectedHost: "",
      method: "failed",
      latencyMs: Date.now() - start,
      usingSSL: creds.useSSL ?? creds.port === 8729,
      error: msg,
      warnings,
      portProbes
    };
  }
}
function generateVpnSetupScript(opts) {
  const {
    routerPublicIp,
    vpsIp,
    vpnPort = 1194,
    vpnUsername = "admin",
    vpnPassword = "ochola",
    tunnelNetwork = "192.168.89",
    lanNetwork = "192.168.180.0/22",
    routerId
  } = opts;
  const routerGateway = `${tunnelNetwork}.1`;
  const clientStart = `${tunnelNetwork}.2`;
  const clientEnd = `${tunnelNetwork}.10`;
  const tunnelNet = `${tunnelNetwork}.0/24`;
  const tag = routerId ? `ISP-${routerId}` : "ISP-OVPN";
  const vpsRestrict = vpsIp ? `src-address=${vpsIp} ` : "";
  const vpsNote = vpsIp ? `# VPN access restricted to VPS IP: ${vpsIp}` : `# WARNING: OVPN port open to all IPs \u2014 set vpsIp to restrict access`;
  return `# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
# OcholaSupernet \u2014 MikroTik OpenVPN Server Setup
# Generated : ${(/* @__PURE__ */ new Date()).toISOString()}
# Router IP : ${routerPublicIp}
# VPN Port  : ${vpnPort}/tcp
# VPN User  : ${vpnUsername}  (password stored in PPP secrets)
# Tunnel    : ${tunnelNet}
# LAN Access: ${lanNetwork}
# ${vpsNote}
#
# USAGE: Paste into RouterOS terminal, or upload and run:
#          /import ovpn-setup-router${routerId ?? ""}.rsc
# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

# \u2500\u2500 Step 1: IP pool for VPN clients \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/ip pool
add name=ovpn-pool ranges=${clientStart}-${clientEnd} comment="${tag}"

# \u2500\u2500 Step 2: PPP profile for VPN sessions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/ppp profile
add name=ovpn-profile \\
    local-address=${routerGateway} \\
    remote-address=ovpn-pool \\
    use-compression=no \\
    use-encryption=yes \\
    use-upnp=no \\
    dns-server=8.8.8.8,1.1.1.1 \\
    comment="${tag}"

# \u2500\u2500 Step 3: VPN user account (PPP secret) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Password is stored in the router's PPP secrets \u2014 not in any config file.
/ppp secret
add name=${vpnUsername} \\
    password=${vpnPassword} \\
    profile=ovpn-profile \\
    service=ovpn \\
    local-address=${routerGateway} \\
    remote-address=${clientStart} \\
    comment="${tag} \u2014 default VPN/API admin (OcholaSupernet backend)"

# \u2500\u2500 Step 4: OpenVPN server \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Requires a certificate. If you don't have one, generate a self-signed cert:
#   /certificate add name=ovpn-ca common-name=ovpn-ca key-usage=key-cert-sign,crl-sign
#   /certificate sign ovpn-ca
#   /certificate add name=ovpn-server common-name=${routerPublicIp}
#   /certificate sign ovpn-server ca=ovpn-ca
/interface ovpn-server server
set enabled=yes \\
    port=${vpnPort} \\
    mode=ip \\
    protocol=tcp \\
    auth=sha1 \\
    cipher=aes128,aes192,aes256 \\
    default-profile=ovpn-profile \\
    require-client-certificate=no \\
    certificate=none

# \u2500\u2500 Step 5: Firewall rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/ip firewall filter

# 5a. Allow OpenVPN connections (port ${vpnPort}) on WAN
add action=accept chain=input \\
    ${vpsRestrict}protocol=tcp dst-port=${vpnPort} \\
    in-interface-list=WAN \\
    comment="${tag}-allow-ovpn"

# 5b. Allow API access (8728 plain + 8729 SSL) from VPN tunnel
add action=accept chain=input \\
    src-address=${tunnelNet} \\
    protocol=tcp dst-port=8728,8729 \\
    comment="${tag}-api-from-vpn"

# 5c. Allow full LAN access from VPN tunnel (PPPoE/Hotspot management)
add action=accept chain=forward \\
    src-address=${tunnelNet} \\
    dst-address=${lanNetwork} \\
    comment="${tag}-lan-from-vpn"

# \u2500\u2500 Step 6: Enable the API service (if not already) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/ip service
enable api
# enable api-ssl   # uncomment if you want encrypted API-SSL on port 8729

# \u2500\u2500 Step 7: Route \u2014 allow VPN clients to reach the LAN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# (Usually handled automatically; add only if your routing table needs it)
# /ip route add dst-address=${lanNetwork} gateway=${routerGateway}

# \u2500\u2500 Verify \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
:log info "${tag}: OpenVPN server configured. User '${vpnUsername}' created."
:log info "${tag}: VPN clients will get IPs in ${tunnelNet}"
:log info "${tag}: API accessible at ${routerGateway}:8728 from VPN tunnel"
`;
}
function generateOvpnClientConfig(opts) {
  const {
    routerPublicIp,
    vpnPort = 1194,
    vpnUsername = "admin",
    vpnPassword = "ochola",
    tunnelClientIp = "192.168.89.2",
    lanNetwork = "192.168.180.0/22",
    apiPorts = "8728, 8729",
    routeAll = false
  } = opts;
  const [lanBase, lanPrefix] = lanNetwork.split("/");
  const lanMask = prefixToMask(parseInt(lanPrefix ?? "24", 10));
  return `# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
# OcholaSupernet \u2014 VPS OpenVPN Client Configuration
# Generated  : ${(/* @__PURE__ */ new Date()).toISOString()}
# Server     : ${routerPublicIp}:${vpnPort}/tcp
# VPN user   : ${vpnUsername}
# Tunnel IP  : ${tunnelClientIp}  (assigned by router)
# LAN access : ${lanNetwork}  (PPPoE/Hotspot management)
# API ports  : ${apiPorts}  (reachable at router tunnel IP after connect)
#
# USAGE on VPS:
#   1. Install OpenVPN:  apt install openvpn
#   2. Save this file:   /etc/openvpn/router-admin.ovpn
#   3. Create creds:     echo "${vpnUsername}\\n${vpnPassword}" > /etc/openvpn/router-creds.txt
#                        chmod 600 /etc/openvpn/router-creds.txt
#   4. Connect:          openvpn --config /etc/openvpn/router-admin.ovpn --daemon
#   5. Verify:           ip addr show tun0    # should show ${tunnelClientIp}
#                        ping 192.168.89.1    # ping router tunnel endpoint
#                        curl http://192.168.89.1:8728  # test API port
#
# ENVIRONMENT VARIABLE \u2014 set in OcholaSupernet backend:
#   MIKROTIK_BRIDGE_IP=${tunnelClientIp.replace(/\.\d+$/, ".1")}  # router's tunnel IP
#
# \u2500\u2500 SECURITY NOTE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# The credentials below are for DEVELOPMENT / initial setup only.
# In production, keep credentials in a separate file (see step 3 above)
# and remove the <auth-user-pass> inline block.
# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

client
dev tun
proto tcp

# OpenVPN server endpoint
remote ${routerPublicIp} ${vpnPort}

resolv-retry infinite
nobind
persist-key
persist-tun

# Authentication
auth SHA1
cipher AES-128-CBC
auth-nocache

# Credentials \u2014 store in a separate file for production:
#   auth-user-pass /etc/openvpn/router-creds.txt
<auth-user-pass>
${vpnUsername}
${vpnPassword}
</auth-user-pass>

# MikroTik uses self-signed certs by default
tls-client
# If you configured a CA on the router, add:
# <ca>
# -----BEGIN CERTIFICATE-----
# ... paste router CA cert here ...
# -----END CERTIFICATE-----
# </ca>

# Disable cert verification for self-signed (remove in production with proper cert)
verify-x509-name none
# OR: ns-cert-type server   (for older RouterOS)

${routeAll ? `# Route ALL traffic through VPN
redirect-gateway def1` : `# Split tunnel \u2014 only route LAN traffic through VPN (recommended)
route-nopull
route ${lanBase} ${lanMask}
# Route to router tunnel subnet (auto-assigned by server, but explicit here for clarity)
route 192.168.89.0 255.255.255.0`}

# Logging
verb 3
log /var/log/openvpn-router.log
`;
}
function prefixToMask(prefix) {
  const mask = prefix === 0 ? 0 : ~0 << 32 - prefix >>> 0;
  return [24, 16, 8, 0].map((s) => mask >> s & 255).join(".");
}
function routerOsString(value) {
  return `"${value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function certificateCommonName(pem) {
  let subject;
  try {
    subject = new import_node_crypto.X509Certificate(pem).subject;
  } catch {
    throw new Error("Management VPN CA certificate PEM could not be parsed.");
  }
  const match = /(?:^|[,\n])CN=([^,\n]+)/.exec(subject);
  const commonName = match?.[1]?.trim() ?? "";
  if (!commonName || /["\r\n]/.test(commonName)) {
    throw new Error("Management VPN CA certificate has no safe common name.");
  }
  return commonName;
}
function validateRouterOpenVpnEndpoint(value) {
  const endpoint = value.trim();
  if (!endpoint || endpoint.length > 255 || !/^[A-Za-z0-9:._-]+$/.test(endpoint)) {
    throw new Error("VPS OpenVPN endpoint must be a hostname or IP address.");
  }
  return endpoint;
}
function validateRouterOpenVpnCaUrl(value) {
  const raw = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Management VPN CA URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Management VPN CA URL must use HTTPS and contain no embedded credentials.");
  }
  return parsed.toString();
}
function validateRouterOpenVpnPort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("VPS OpenVPN port must be an integer between 1 and 65535.");
  }
  return value;
}
function validateRouterOpenVpnCredential(value, label) {
  if (!value || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`VPS OpenVPN ${label} is empty or contains control characters.`);
  }
  if (label === "username" && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(value)) {
    throw new Error("VPS OpenVPN username must contain only letters, numbers, '_' or '-'.");
  }
  return value;
}
function validateRouterOsResourceName(value, label) {
  const resource = String(value ?? "").trim();
  if (!resource || resource.length > 63 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(resource)) {
    throw new Error(`${label} must contain only letters, numbers, dots, underscores, or hyphens.`);
  }
  return resource;
}
function routerHotspotGateway(value) {
  const raw = String(value ?? "").trim();
  const [rawIp, rawPrefix] = raw.split("/");
  const octets = rawIp?.split(".").map(Number) ?? [];
  const prefix = Number(rawPrefix);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255) || !Number.isInteger(prefix) || prefix < 1 || prefix > 30) {
    throw new Error("Hotspot LAN network must be a valid IPv4 CIDR between /1 and /30.");
  }
  const ip = ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3] >>> 0;
  const mask = 4294967295 << 32 - prefix >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask >>> 0) >>> 0;
  const gateway = network + 1;
  if (gateway >= broadcast) {
    throw new Error("Hotspot LAN network does not have a usable gateway address.");
  }
  return {
    address: [
      gateway >>> 24 & 255,
      gateway >>> 16 & 255,
      gateway >>> 8 & 255,
      gateway & 255
    ].join("."),
    prefix
  };
}
function generateRouterAsClientScript(opts) {
  const {
    vpsPublicIp,
    vpnPort = ROUTER_MANAGEMENT_VPN.port,
    vpnUsername,
    vpnPassword,
    caCertificateUrl,
    managementCaCertificatePem,
    caCertificateName = "ochola-router-management-ca",
    backendRegistrationUrl,
    tunnelRouterIp,
    tunnelVpsIp = "10.8.5.1",
    lanNetwork = "192.168.180.0/22",
    routerId,
    routerOsMajor = 6,
    autoDetectRouterOsMajor = false,
    vpnRole = "primary",
    backupVpnPort,
    backupVpnUsername,
    backupVpnPassword,
    backupTunnelRouterIp,
    backupTunnelVpsIp = ROUTER_MANAGEMENT_VPN_BACKUP.gateway,
    installationMode = "coexist",
    bridgeName,
    bridgePorts = [],
    apiUsername,
    apiPassword,
    managementApiUsername,
    managementApiPassword,
    hotspotAssets = [],
    minimalManagementSetup = false
  } = opts;
  const endpoint = validateRouterOpenVpnEndpoint(vpsPublicIp);
  const port = validateRouterOpenVpnPort(vpnPort);
  const safeVpnUsername = validateRouterOpenVpnCredential(vpnUsername, "username");
  const safeVpnPassword = validateRouterOpenVpnCredential(vpnPassword, "password");
  const backupValues = [
    backupVpnPort,
    backupVpnUsername,
    backupVpnPassword,
    backupTunnelRouterIp
  ];
  const hasBackupManagementVpn = backupValues.some((value) => value !== void 0 && String(value).trim() !== "");
  if (hasBackupManagementVpn && backupValues.some((value) => value === void 0 || String(value).trim() === "")) {
    throw new Error("Backup management VPN configuration must include port, credentials, and router tunnel IP.");
  }
  const safeBackupVpnUsername = hasBackupManagementVpn ? validateRouterOpenVpnCredential(backupVpnUsername ?? "", "backup username") : "";
  const safeBackupVpnPassword = hasBackupManagementVpn ? validateRouterOpenVpnCredential(backupVpnPassword ?? "", "backup password") : "";
  const backupPort = hasBackupManagementVpn ? validateRouterOpenVpnPort(backupVpnPort ?? 0) : 0;
  const safeBackupTunnelRouterIp = hasBackupManagementVpn ? String(backupTunnelRouterIp).trim() : "";
  if (hasBackupManagementVpn && !/^10\.8\.6\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-3])$/.test(safeBackupTunnelRouterIp)) {
    throw new Error("Backup management tunnel IP must be a valid host in the isolated 10.8.6.0/24 network.");
  }
  const safeBackupTunnelVpsIp = hasBackupManagementVpn ? String(backupTunnelVpsIp).trim() : "";
  if (hasBackupManagementVpn && safeBackupTunnelVpsIp !== ROUTER_MANAGEMENT_VPN_BACKUP.gateway) {
    throw new Error("Backup management tunnel gateway must remain 10.8.6.1.");
  }
  const safeCaCertificateUrl = validateRouterOpenVpnCaUrl(caCertificateUrl);
  const embeddedManagementCa = String(managementCaCertificatePem ?? ISRG_ROOT_X1_PEM).trim();
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(embeddedManagementCa)) {
    throw new Error("Management VPN CA certificate PEM is missing or invalid.");
  }
  const embeddedManagementCaCommonName = certificateCommonName(embeddedManagementCa);
  const safeBackendRegistrationUrl = validateRouterOpenVpnCaUrl(backendRegistrationUrl);
  const safeCaCertificateName = validateRouterOsResourceName(
    caCertificateName,
    "RouterOS CA certificate filename"
  );
  const coexistence = installationMode === "coexist" || installationMode === "direct";
  const routerOs7 = !autoDetectRouterOsMajor && routerOsMajor >= 7;
  const routerOsPath = autoDetectRouterOsMajor ? "auto-detected RouterOS 6/7" : routerOs7 ? "RouterOS 7+" : "RouterOS 6";
  const openVpnCipher = autoDetectRouterOsMajor ? "$ocholaOpenVpnCipher" : routerOs7 ? "aes128-cbc" : "aes128";
  const openVpnDisplayCipher = autoDetectRouterOsMajor ? "auto-detected (RouterOS 6: aes128; RouterOS 7+: aes128-cbc)" : openVpnCipher;
  const contract = vpnRole === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
  const roleSuffix = vpnRole === "backup" ? "-backup" : "";
  const interfaceName = vpnRole === "primary" ? ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME : installationMode === "direct" ? `${ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME}-backup` : routerId ? routerManagementClientInterfaceName(routerId, vpnRole) : `${ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME}${roleSuffix}`;
  const tag = routerId ? `ochola-mgmt-vpn-${routerId}${roleSuffix}` : `ocholasupernet${roleSuffix}`;
  const interfaceComment = vpnRole === "primary" ? ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT : routerId ? `${tag} VPS tunnel` : `${ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT}${roleSuffix}`;
  const backupInterfaceName = `${interfaceName}-backup`;
  const backupInterfaceComment = `${interfaceComment}-backup`;
  const failoverSchedulerName = routerId ? `ochola-mgmt-failover-${routerId}` : "ocholasupernet-mgmt-failover";
  const safeBridgeName = !minimalManagementSetup && bridgeName ? validateRouterOsResourceName(bridgeName, "Self Install bridge name") : "";
  const safeBridgePorts = (minimalManagementSetup ? [] : bridgePorts).map((port2) => validateRouterOsResourceName(port2, "Self Install bridge port")).filter((port2, index, values) => values.indexOf(port2) === index);
  const safeApiUsername = !minimalManagementSetup && apiUsername ? validateRouterOsResourceName(apiUsername, "RouterOS API username") : "";
  const safeApiPassword = !minimalManagementSetup && apiPassword ? validateRouterOpenVpnCredential(apiPassword, "API password") : "";
  const safeManagementApiUsername = !minimalManagementSetup && managementApiUsername ? validateRouterOsResourceName(managementApiUsername, "RouterOS management API username") : "";
  const safeManagementApiPassword = managementApiPassword ? validateRouterOpenVpnCredential(managementApiPassword, "API password") : "";
  const hotspotGateway = safeBridgeName ? routerHotspotGateway(lanNetwork) : null;
  const safeHotspotAssets = (minimalManagementSetup ? [] : hotspotAssets).map((asset) => {
    const destinationPath = String(asset.destinationPath ?? "").trim().replaceAll("\\", "/");
    if (!/^flash\/hotspot\/[A-Za-z0-9._/-]+$/.test(destinationPath) || destinationPath.includes("..")) {
      throw new Error("Self Install hotspot asset destination is invalid.");
    }
    return {
      sourceUrl: validateRouterOpenVpnCaUrl(asset.sourceUrl),
      destinationPath,
      sourceName: String(asset.sourceName ?? destinationPath.split("/").pop() ?? "asset").replace(/[\u0000-\u001F\u007F"]/g, "")
    };
  });
  const hotspotDirectories = Array.from(/* @__PURE__ */ new Set([
    "flash/hotspot",
    ...safeHotspotAssets.map((asset) => asset.destinationPath.slice(0, asset.destinationPath.lastIndexOf("/")))
  ])).sort((left, right) => left.split("/").length - right.split("/").length);
  const hotspotAssetInstall = safeHotspotAssets.length > 0 ? `# Step 10: Import the approved hotspot asset bundle
# Existing files are preserved so a retry cannot replace a customized portal.
:put "${tag}: STEP 10/10 - Installing ${safeHotspotAssets.length} approved hotspot assets."
${hotspotDirectories.map((directory) => `:do { /file make-dir dir-name=${routerOsString(directory)} } on-error={}`).join("\n")}
${safeHotspotAssets.map((asset) => `:if ([:len [/file find where name=${routerOsString(asset.destinationPath)}]] = 0) do={
    :do {
        /tool fetch url=${routerOsString(asset.sourceUrl)} dst-path=${routerOsString(asset.destinationPath)} keep-result=yes mode=https check-certificate=yes
        :if ([:len [/file find where name=${routerOsString(asset.destinationPath)}]] = 0) do={
            :put "${asset.sourceName}: RouterOS did not create the destination file."
        } else={
            :put "${asset.sourceName}: hotspot asset installed."
        }
    } on-error={
        :local hotspotAssetError $error
        :put ("${asset.sourceName}: hotspot asset download failed: " . $hotspotAssetError)
    }
} else={
    :put "${asset.sourceName}: already present; preserved."
}`).join("\n")}
:put "${tag}: STEP 10/10 complete - hotspot asset installation finished."` : `:put "${tag}: STEP 10/10 skipped - no approved hotspot assets were requested."`;
  const resourcePreparation = coexistence ? `# Coexistence guard: never replace a foreign VPN or API policy. A previous
# incomplete Ochola attempt may leave its uniquely tagged, non-running client
# behind; remove only that stale resource so the administrator can retry.
:local existingOvpnIds [/interface ovpn-client find where name="${interfaceName}"]
:if ([:len $existingOvpnIds] > 0) do={
    :local existingOvpnId [:pick $existingOvpnIds 0]
    :local existingOvpnComment [/interface ovpn-client get $existingOvpnId comment]
    :local existingOvpnRunning [/interface ovpn-client get $existingOvpnId running]
    :if ($existingOvpnComment = "${interfaceComment}") do={
        :if (!$existingOvpnRunning) do={
            :do { /interface ovpn-client remove $existingOvpnId } on-error={
                :set ocholaVpnChildError "${tag}: could not remove the previous incomplete management interface; nothing was replaced."
                :error $ocholaVpnChildError
            }
        } else={
            :set reuseExistingOvpn true
            :put "${tag}: existing active management VPN reused for retry."
        }
    } else={
        :set ocholaVpnChildError "${tag}: coexistence conflict - an active or foreign ${interfaceName} interface was found; nothing was replaced."
        :error $ocholaVpnChildError
    }
}
${hasBackupManagementVpn ? `:local existingBackupOvpnIds [/interface ovpn-client find where name="${backupInterfaceName}"]
:if ([:len $existingBackupOvpnIds] > 0) do={
    :local existingBackupOvpnId [:pick $existingBackupOvpnIds 0]
    :local existingBackupOvpnComment [/interface ovpn-client get $existingBackupOvpnId comment]
    :if ($existingBackupOvpnComment = "${backupInterfaceComment}") do={
        :set reuseExistingBackupOvpn true
        :do { /interface ovpn-client set $existingBackupOvpnId disabled=yes } on-error={
            :set ocholaVpnChildError "${tag}: could not disable the previous backup management interface."
            :error $ocholaVpnChildError
        }
    } else={
        :set ocholaVpnChildError "${tag}: coexistence conflict - a foreign ${backupInterfaceName} interface was found; nothing was replaced."
        :error $ocholaVpnChildError
    }
}` : ""}
${minimalManagementSetup ? "" : `:if ([:len [/ip service find where name="api" && disabled=yes]] > 0) do={
    :set ocholaVpnChildError "${tag}: coexistence conflict - RouterOS API is disabled; it was not enabled."
    :error $ocholaVpnChildError
}`}` : `:do { /system scheduler remove [find where name="${failoverSchedulerName}"] } on-error={}
:do { /interface ovpn-client remove [find where name="ovpn-to-vps"] } on-error={}
:do { /interface ovpn-client remove [find where name="ocholasupernet" comment="mainbillingvpn"] } on-error={}
:do { /interface ovpn-client remove [find where name="${backupInterfaceName}"] } on-error={}
:do { /interface ovpn-client remove [find where name="coreispbilling"] } on-error={}
:do { /interface ovpn-client remove [find where name="${interfaceName}"] } on-error={}`;
  const firewallPreparation = coexistence ? `:if ([:len [/ip firewall filter find where comment="${tag}-api-from-vps-tunnel"]] = 0) do={ :do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vps-tunnel" place-before=0 } on-error={ :set ovpnError "RouterOS rejected the coexistence API firewall rule." } }
:if ([:len $ovpnError] > 0) do={ :set ocholaVpnChildError ("${tag}: " . $ovpnError) ; :error $ocholaVpnChildError }
${hasBackupManagementVpn ? `:if ([:len [/ip firewall filter find where comment="${tag}-backup-api-from-vps-tunnel"]] = 0) do={ :do { /ip firewall filter add action=accept chain=input src-address=${safeBackupTunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-backup-api-from-vps-tunnel" place-before=0 } on-error={ :set ovpnError "RouterOS rejected the backup coexistence API firewall rule." } }` : ""}
:if ([:len $ovpnError] > 0) do={ :set ocholaVpnChildError ("${tag}: " . $ovpnError) ; :error $ocholaVpnChildError }
:if ([:len [/ip firewall filter find where comment="${tag}-ping-from-vps-tunnel"]] = 0) do={ :do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=icmp comment="${tag}-ping-from-vps-tunnel" } on-error={ :set ovpnError "RouterOS rejected the coexistence ping firewall rule." } }
${hasBackupManagementVpn ? `:if ([:len [/ip firewall filter find where comment="${tag}-backup-ping-from-vps-tunnel"]] = 0) do={ :do { /ip firewall filter add action=accept chain=input src-address=${safeBackupTunnelVpsIp}/32 protocol=icmp comment="${tag}-backup-ping-from-vps-tunnel" } on-error={ :set ovpnError "RouterOS rejected the backup coexistence ping firewall rule." } }` : ""}
:if ([:len $ovpnError] > 0) do={ :set ocholaVpnChildError ("${tag}: " . $ovpnError) ; :error $ocholaVpnChildError }` : `/ip firewall filter
remove [find where comment="${tag}-api-from-vps-tunnel"]
add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vps-tunnel" place-before=0
${hasBackupManagementVpn ? `remove [find where comment="${tag}-backup-api-from-vps-tunnel"]
add action=accept chain=input src-address=${safeBackupTunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-backup-api-from-vps-tunnel" place-before=0` : ""}
remove [find where comment="${tag}-ping-from-vps-tunnel"]
add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=icmp comment="${tag}-ping-from-vps-tunnel"
${hasBackupManagementVpn ? `remove [find where comment="${tag}-backup-ping-from-vps-tunnel"]
add action=accept chain=input src-address=${safeBackupTunnelVpsIp}/32 protocol=icmp comment="${tag}-backup-ping-from-vps-tunnel"` : ""}`;
  const bridgeSetup = safeBridgeName ? `# Step 5: Create the requested hotspot bridge and add only the selected ports
:put "${tag}: STEP 5/10 - Configuring hotspot bridge ${safeBridgeName}."
/interface bridge
:if ([:len [/interface bridge find where name="${safeBridgeName}"]] = 0) do={
     :do { /interface bridge add name="${safeBridgeName}"${safeBridgeName === "hotspot-bridge" ? "" : ` comment="${tag} hotspot bridge"`} } on-error={
        :set ocholaVpnChildError "${tag}: hotspot bridge creation failed."
        :error $ocholaVpnChildError
    }
 }
${safeBridgeName === "hotspot-bridge" ? `/interface bridge set [find where name="${safeBridgeName}"] comment=""` : ""}
${safeBridgePorts.map((port2) => `:put "${tag}: STEP 5/10 - Checking physical port ${port2}."
:if ([:len [/interface find where name="${port2}"]] = 0) do={
    :set ocholaVpnChildError "${tag}: physical interface ${port2} was not found."
    :error $ocholaVpnChildError
}
:if ([:len [/interface bridge port find where bridge="${safeBridgeName}" && interface="${port2}"]] = 0) do={
    :put "${tag}: STEP 5/10 - Adding ${port2} to ${safeBridgeName}."
    :do { /interface bridge port add bridge="${safeBridgeName}" interface="${port2}" comment="${tag} hotspot port" } on-error={
        :set ocholaVpnChildError "${tag}: could not add ${port2} to ${safeBridgeName}."
        :error $ocholaVpnChildError
    }
:put "${tag}: STEP 5/10 - ${port2} is attached to ${safeBridgeName}."
`).join("\n")}
:local hotspotAddress "${hotspotGateway.address}/${hotspotGateway.prefix}"
:put ("${tag}: STEP 5/10 - Verifying hotspot gateway " . $hotspotAddress . " on ${safeBridgeName}.")
:if ([:len [/ip address find where address=$hotspotAddress && interface="${safeBridgeName}"]] = 0) do={
    :do {
        /ip address add address=$hotspotAddress interface="${safeBridgeName}" comment="${tag} hotspot gateway"
    } on-error={
        :set ocholaVpnChildError "${tag}: could not add hotspot gateway $hotspotAddress to ${safeBridgeName}."
        :error $ocholaVpnChildError
    }
}
:if ([:len [/ip address find where address=$hotspotAddress && interface="${safeBridgeName}"]] = 0) do={
    :set ocholaVpnChildError "${tag}: hotspot gateway $hotspotAddress was not verified on ${safeBridgeName}."
    :error $ocholaVpnChildError
}
:if ([:len [/interface bridge find where name="${safeBridgeName}"]] = 0) do={
    :set ocholaVpnChildError "${tag}: hotspot bridge was not verified."
    :error $ocholaVpnChildError
}
:put "${tag}: STEP 5/10 complete - bridge, ports, and gateway verified."` : "";
  const safeApiUsernames = Array.from(new Set([safeManagementApiUsername, safeApiUsername].filter(Boolean)));
  const apiUserSetup = safeApiPassword && safeApiUsernames.length > 0 ? `# Step 5: Create or reconcile the dedicated management API accounts
/user
${safeApiUsernames.map((username) => `:local managementUserIds [/user find where name="${username}"]
:if ([:len $managementUserIds] = 0) do={
    :do { add name="${username}" group=full password="${safeApiPassword}" comment="${username === safeManagementApiUsername ? "DO NOT DELETE - OcholaSupernet management API" : `${tag} router management API`}" } on-error={
        :set ocholaVpnChildError "${tag}: management API user creation failed for ${username}."
        :error $ocholaVpnChildError
    }
} else={
    :do { set [:pick $managementUserIds 0] group=full password="${safeApiPassword}" disabled=no comment="${username === safeManagementApiUsername ? "DO NOT DELETE - OcholaSupernet management API" : `${tag} router management API`}" } on-error={
        :set ocholaVpnChildError "${tag}: management API user update failed for ${username}."
        :error $ocholaVpnChildError
    }
}
:if ([:len [/user find where name="${username}" && disabled=no]] = 0) do={
    :set ocholaVpnChildError "${tag}: management API user ${username} was not verified."
    :error $ocholaVpnChildError
}`).join("\n")}` : "";
  const managementApiUserSetup = safeManagementApiPassword ? `# Create the stable backend API account without removing any existing users.
/user
:local ocholaManagementUserIds [/user find where name="ocholasupernet"]
:if ([:len $ocholaManagementUserIds] = 0) do={
    :do {
        add name="ocholasupernet" group=full password=${routerOsString(safeManagementApiPassword)} disabled=no comment="DO NOT DELETE - OcholaSupernet API"
    } on-error={
        :set ocholaVpnChildError "${tag}: ocholasupernet API user creation failed."
        :error $ocholaVpnChildError
    }
} else={
    :do {
        set [:pick $ocholaManagementUserIds 0] group=full password=${routerOsString(safeManagementApiPassword)} disabled=no comment="DO NOT DELETE - OcholaSupernet API"
    } on-error={
        :set ocholaVpnChildError "${tag}: ocholasupernet API user update failed."
        :error $ocholaVpnChildError
    }
}
:if ([:len [/user find where name="ocholasupernet" && disabled=no]] = 0) do={
    :set ocholaVpnChildError "${tag}: ocholasupernet API user was not verified."
    :error $ocholaVpnChildError
}` : "";
  const apiNetworks = ["10.8.0.0/24", "10.8.5.0/24", "10.8.6.0/24"];
  const apiNetworkCsv = apiNetworks.join(",");
  const apiServiceAddresses = hasBackupManagementVpn ? `${tunnelVpsIp}/32,${safeBackupTunnelVpsIp}/32` : `${tunnelVpsIp}/32`;
  const natSetup = safeBridgeName ? `# Step 6: Add only the management NAT rules needed for the two interfaces
/ip firewall nat
remove [find where comment="${tag}-mgmt-to-hotspot-nat"]
add chain=srcnat action=masquerade src-address=${tunnelVpsIp}/32 out-interface="${safeBridgeName}" comment="${tag}-mgmt-to-hotspot-nat"
${hasBackupManagementVpn ? `remove [find where comment="${tag}-backup-mgmt-to-hotspot-nat"]
add chain=srcnat action=masquerade src-address=${safeBackupTunnelVpsIp}/32 out-interface="${safeBridgeName}" comment="${tag}-backup-mgmt-to-hotspot-nat"` : ""}
remove [find where comment="${tag}-hotspot-to-mgmt-nat"]
add chain=srcnat action=masquerade src-address=${lanNetwork} out-interface="${interfaceName}" comment="${tag}-hotspot-to-mgmt-nat"
${hasBackupManagementVpn ? `remove [find where comment="${tag}-hotspot-to-backup-mgmt-nat"]
add chain=srcnat action=masquerade src-address=${lanNetwork} out-interface="${backupInterfaceName}" comment="${tag}-hotspot-to-backup-mgmt-nat"` : ""}` : "";
  const openVpnOptionalSettings = autoDetectRouterOsMajor ? `# The auto-detected path keeps RouterOS 6 free of RouterOS 7-only
# properties. RouterOS parses the verification command at runtime only after
# the local major-version check has selected RouterOS 7.
:if ($ocholaRouterOsMajor = "7") do={
    :do {
        :local ocholaVerifyServerCertificate [:parse "/interface ovpn-client set [find where name=\\"${interfaceName}\\"] verify-server-certificate=yes"]
        $ocholaVerifyServerCertificate
    } on-error={
        :set ocholaVpnChildError "${tag}: RouterOS 7 could not enable OpenVPN server certificate verification."
        :error $ocholaVpnChildError
    }
}` : routerOs7 ? `# RouterOS 7 path: certificate verification is mandatory.
:do {
    /interface ovpn-client set [find where name="${interfaceName}"] verify-server-certificate=yes
} on-error={
    :set ocholaVpnChildError "${tag}: RouterOS 7 could not enable OpenVPN server certificate verification."
    :error $ocholaVpnChildError
}` : `# RouterOS 6 path: keep the client command to the conservative common property set.
# RouterOS 6 must not parse RouterOS 7-only OpenVPN properties.`;
  const backupOpenVpnOptionalSettings = hasBackupManagementVpn ? autoDetectRouterOsMajor ? `:do {
    :if ($ocholaRouterOsMajor = "7") do={
        :local ocholaVerifyBackupServerCertificate [:parse "/interface ovpn-client set [find where name=\\"${backupInterfaceName}\\"] verify-server-certificate=yes"]
        $ocholaVerifyBackupServerCertificate
    }
} on-error={
    :set ocholaVpnChildError "${tag}: RouterOS 7 could not enable backup OpenVPN server certificate verification."
    :error $ocholaVpnChildError
}` : "" : "";
  const openVpnPostCreateSettings = `# Apply optional OpenVPN settings only after the portable client exists.
:do {
    /interface ovpn-client set [find where name="${interfaceName}"] mode=ip cipher=${openVpnCipher} auth=sha1 add-default-route=no
} on-error={
    :set ocholaVpnChildError "${tag}: OpenVPN client options were rejected after interface creation."
    :error $ocholaVpnChildError
}
${hasBackupManagementVpn ? `:do {
    /interface ovpn-client set [find where name="${backupInterfaceName}"] mode=ip cipher=${openVpnCipher} auth=sha1 add-default-route=no
} on-error={
    :set ocholaVpnChildError "${tag}: backup OpenVPN client options were rejected after interface creation."
    :error $ocholaVpnChildError
}` : ""}`;
  const openVpnPreflight = `# Create the management interface disabled while CA trust is prepared.
# This makes the requested OVPN interface visible even if the CA bootstrap
# needs to be repaired and retried.
:put "${tag}: Creating management OpenVPN client interface (disabled pending CA trust)."
:if (!$reuseExistingOvpn) do={
 :do { /interface ovpn-client add name=${routerOsString(interfaceName)} connect-to=${routerOsString(endpoint)} port=${port} user=${routerOsString(safeVpnUsername)} password=${routerOsString(safeVpnPassword)} disabled=yes comment="${interfaceComment}" } on-error={
    :local routerError ""
    :do { :set routerError $error } on-error={}
    :set ovpnError "RouterOS rejected the OpenVPN client add command"
    :if ([:len $routerError] > 0) do={ :set ovpnError ($ovpnError . ": " . $routerError) }
 }
}
:if ([:len $ovpnError] > 0) do={
    :set ocholaVpnChildError ("${tag}: OVPN client creation failed: " . $ovpnError)
    :error $ocholaVpnChildError
}
:put "${tag}: Management OpenVPN client interface is present and disabled until CA trust succeeds."`;
  const backupOpenVpnPreflight = hasBackupManagementVpn ? `# Create the backup client disabled. The failover scheduler enables it only
# after the primary client is no longer running.
:put "${tag}: Creating backup management OpenVPN client interface (standby)."
:if (!$reuseExistingBackupOvpn) do={
 :do { /interface ovpn-client add name=${routerOsString(backupInterfaceName)} connect-to=${routerOsString(endpoint)} port=${backupPort} user=${routerOsString(safeBackupVpnUsername)} password=${routerOsString(safeBackupVpnPassword)} disabled=yes comment="${backupInterfaceComment}" } on-error={
    :local routerError ""
    :do { :set routerError $error } on-error={}
    :set ovpnError "RouterOS rejected the backup OpenVPN client add command"
    :if ([:len $routerError] > 0) do={ :set ovpnError ($ovpnError . ": " . $routerError) }
 }
}
:if ([:len $ovpnError] > 0) do={
    :set ocholaVpnChildError ("${tag}: backup OVPN client creation failed: " . $ovpnError)
    :error $ocholaVpnChildError
}
:put "${tag}: Backup management OpenVPN client is present and disabled in primary-first standby mode."` : "";
  const caFileName = `${safeCaCertificateName}.crt`;
  const caBuildBaseName = `${safeCaCertificateName}-bootstrap`;
  const caBuildFileName = `${caBuildBaseName}.txt`;
  const httpsCaFileName = `${safeCaCertificateName}-https-root.crt`;
  const httpsCaBuildBaseName = `${safeCaCertificateName}-https-root`;
  const httpsCaBuildFileName = `${httpsCaBuildBaseName}.txt`;
  const publicHttpsCaCommonName = certificateCommonName(ISRG_ROOT_X1_PEM);
  const caBootstrap = `# Step 1: Import the management VPN CA
# Prefer the RouterOS built-in trust store. If it cannot validate the public
# endpoint yet, use the embedded management OpenVPN CA instead of trusting an
# unverified download.
:global ocholaCaPhase
:global ocholaCaError
:global ocholaCaImportError
:set ocholaCaPhase "prepare CA file"
:set ocholaCaError ""
:set ocholaCaImportError ""
:put "${tag}: STEP 1/10 - Starting CA trust bootstrap."
:do {
    :do { /file remove [find name="${caFileName}"] } on-error={}
    :do { /file remove [find name="${caBuildFileName}"] } on-error={}
    :local fetchedViaTrustedStore false
    :do {
        /tool fetch url=${routerOsString(safeCaCertificateUrl)} dst-path="${caFileName}" keep-result=yes mode=https check-certificate=yes
        :set fetchedViaTrustedStore true
    } on-error={}
    :if ($fetchedViaTrustedStore && [:len [/file find name="${caFileName}"]] = 0) do={
        :set fetchedViaTrustedStore false
        :put "${tag}: RouterOS reported a completed CA fetch but did not create the destination file; using the embedded management OpenVPN CA."
    }
    :if (!$fetchedViaTrustedStore) do={
        :put "${tag}: RouterOS built-in trust did not validate the CA endpoint; writing the embedded management OpenVPN CA."
        :set ocholaCaPhase "create embedded CA file"
${routerOsTextVariableWriter(embeddedManagementCa, "ocholaExpectedCa", "        ")}
        :do {
            /file print file="${caBuildBaseName}"
            :delay 1s
            /file set [find name="${caBuildFileName}"] contents=$ocholaExpectedCa
        } on-error={
            :set ocholaCaImportError $error
        }
        :if ([:len $ocholaCaImportError] > 0) do={
            :error ("management VPN embedded CA file creation failed: " . $ocholaCaImportError)
        }
        :if ([:len [/file find name="${caBuildFileName}"]] = 0) do={
            :error "management VPN embedded CA file was not created"
        }
    }
    :set ocholaCaPhase "verify CA file"
    :if (!$fetchedViaTrustedStore) do={
        :if ([:len [/file find name="${caBuildFileName}"]] = 0) do={
            :error "management VPN CA embedded file was not created"
        }
    } else={
        :if ([:len [/file find name="${caFileName}"]] = 0) do={
            :error "management VPN CA downloaded file was not created"
        }
    }
    :set ocholaCaPhase "import CA certificate"
    :if (!$fetchedViaTrustedStore) do={
        :do {
            /certificate import file-name="${caBuildFileName}" passphrase=""
        } on-error={
            :set ocholaCaImportError $error
        }
    } else={
        :do {
            /certificate import file-name="${caFileName}" passphrase=""
        } on-error={
            :set ocholaCaImportError $error
        }
    }
    :if ([:len $ocholaCaImportError] > 0) do={
        :error ("management VPN CA certificate import failed: " . $ocholaCaImportError)
    }
    :set ocholaCaPhase "verify imported CA certificate"
    :if ([:len [/certificate find where common-name=${routerOsString(embeddedManagementCaCommonName)}]] = 0) do={
        :error "management VPN CA certificate common name was not found after import"
    }
    :set ocholaCaPhase "trust imported CA certificate"
    :do {
        /certificate set [find where common-name=${routerOsString(embeddedManagementCaCommonName)}] trusted=yes
    } on-error={
        :set ocholaCaImportError $error
    }
    :if ([:len $ocholaCaImportError] > 0) do={
        :error ("management VPN CA trust update failed: " . $ocholaCaImportError)
    }
    :set ocholaCaPhase "prepare public HTTPS CA"
    :set ocholaCaImportError ""
    :if ([:len [/certificate find where common-name=${routerOsString(publicHttpsCaCommonName)}]] = 0) do={
${routerOsTextVariableWriter(ISRG_ROOT_X1_PEM, "ocholaHttpsCa", "        ")}
        :do { /file remove [find name="${httpsCaFileName}"] } on-error={}
        :do { /file remove [find name="${httpsCaBuildFileName}"] } on-error={}
        :do {
            /file print file="${httpsCaBuildBaseName}"
            :delay 1s
            /file set [find name="${httpsCaBuildFileName}"] contents=$ocholaHttpsCa
        } on-error={
            :set ocholaCaImportError $error
        }
        :if ([:len $ocholaCaImportError] > 0) do={
            :error ("public HTTPS CA file creation failed: " . $ocholaCaImportError)
        }
        :do {
            /certificate import file-name="${httpsCaBuildFileName}" passphrase=""
        } on-error={
            :set ocholaCaImportError $error
        }
        :if ([:len $ocholaCaImportError] > 0) do={
            :error ("public HTTPS CA certificate import failed: " . $ocholaCaImportError)
        }
    }
    :set ocholaCaPhase "trust public HTTPS CA"
    :set ocholaCaImportError ""
    :do {
        /certificate set [find where common-name=${routerOsString(publicHttpsCaCommonName)}] trusted=yes
    } on-error={
        :set ocholaCaImportError $error
    }
    :if ([:len $ocholaCaImportError] > 0) do={
        :error ("public HTTPS CA trust update failed: " . $ocholaCaImportError)
    }
    :set ocholaCaPhase "clean up CA file"
    :do { /file remove [find name="${caFileName}"] } on-error={}
    :do { /file remove [find name="${caBuildFileName}"] } on-error={}
    :do { /file remove [find name="${httpsCaFileName}"] } on-error={}
    :do { /file remove [find name="${httpsCaBuildFileName}"] } on-error={}
    :if ([:len [/certificate find where common-name=${routerOsString(embeddedManagementCaCommonName)}]] = 0) do={
        :error "management VPN CA was not imported"
    }
    :if ([:len [/certificate find where common-name=${routerOsString(publicHttpsCaCommonName)}]] = 0) do={
        :error "public HTTPS CA was not imported"
    }
    :put "${tag}: STEP 1/10 complete - management and public HTTPS CA certificates imported and trusted."
} on-error={
    :set ocholaCaError $error
    :if ([:len $ocholaCaError] = 0) do={
        :set ocholaCaError "RouterOS returned no diagnostic text"
    }
    :set ocholaVpnChildError ("${tag}: management VPN CA failed during " . $ocholaCaPhase . ": " . $ocholaCaError)
    :error $ocholaVpnChildError
}

# Step 2: Create the OVPN client interface
# Make this safe to re-import during recovery or after a failed migration.
`;
  const routerOsDetection = autoDetectRouterOsMajor ? `# Detect the installed RouterOS major before selecting version-sensitive values.
:local ocholaRouterOsVersion ""
:local ocholaRouterOsMajor ""
:do {
    :set ocholaRouterOsVersion [/system resource get version]
    :set ocholaRouterOsMajor [:pick $ocholaRouterOsVersion 0 1]
} on-error={
    :set ocholaVpnChildError "${tag}: could not read the installed RouterOS version."
    :error $ocholaVpnChildError
}
:if (($ocholaRouterOsMajor != "6") && ($ocholaRouterOsMajor != "7")) do={
    :set ocholaVpnChildError ("${tag}: unsupported RouterOS major version " . $ocholaRouterOsVersion . "; expected 6 or 7.")
    :error $ocholaVpnChildError
}
:local ocholaOpenVpnCipher "aes128"
:if ($ocholaRouterOsMajor = "7") do={
    :set ocholaOpenVpnCipher "aes128-cbc"
}
:put ("${tag}: detected RouterOS " . $ocholaRouterOsVersion . "; using cipher " . $ocholaOpenVpnCipher . ".")` : "";
  return `# ===============================================================
# OcholaSupernet - MikroTik ${routerOsPath} Router as OpenVPN CLIENT
# Generated  : ${(/* @__PURE__ */ new Date()).toISOString()}
# Architecture: Router connects TO VPS (VPS is the OVPN server)
#
# VPS OVPN server : ${endpoint}:${port}/tcp  (${contract.interfaceName} ${tunnelVpsIp})
# Router tunnel IP: dynamic (discover it from /ip address after connect)
# VPN user        : ${safeVpnUsername}
# OpenVPN cipher  : ${openVpnDisplayCipher} / auth=sha1
#
# After import:
#   - Router connects to VPS and receives a dynamic tunnel IPv4 address
#   - The script reports the actual address; backend registration must confirm it
#
# REQUIREMENTS on VPS side (run the dedicated router-management OpenVPN setup first):
#   - VPS OpenVPN server must use proto tcp
#   - User '${vpnUsername}' must be added to the dedicated router-management auth file
#   - The server certificate must chain to the imported management VPN CA
#
# USAGE: /import router-as-client${routerId ?? ""}.rsc
# VERSION PATH: ${routerOsPath}; this file contains only that version's cipher syntax.
# DIAGNOSTICS: on failure, inspect the printed OVPN state and /log entries with
#              /log print where topics~"ovpn"
# ===============================================================

:global ocholaVpnChildError
:set ocholaVpnChildError ""
:local ovpnError ""
:local reuseExistingOvpn false
${hasBackupManagementVpn ? ":local reuseExistingBackupOvpn false" : ""}
${routerOsDetection}
:if ([:len "$ocholaVpnChildError"] = 0) do={
:put "${tag}: STEP 2/10 - Preparing management VPN resources."
${resourcePreparation}
:put "${tag}: STEP 2/10 complete - management VPN resources ready."
${openVpnPreflight}
${caBootstrap}
:put "${tag}: STEP 3/10 - Enabling management OpenVPN client."
${backupOpenVpnPreflight}
${openVpnPostCreateSettings}
${openVpnOptionalSettings}
${backupOpenVpnOptionalSettings}
:if (!$reuseExistingOvpn) do={
    :do { /interface ovpn-client set [find where name="${interfaceName}"] disabled=no } on-error={
        :set ocholaVpnChildError "${tag}: management OpenVPN client could not be enabled after CA trust succeeded."
        :error $ocholaVpnChildError
    }
}
:if (${hasBackupManagementVpn ? "!$reuseExistingBackupOvpn" : "false"}) do={
    :do { /interface ovpn-client set [find where name="${backupInterfaceName}"] disabled=yes } on-error={
        :set ocholaVpnChildError "${tag}: backup management OpenVPN client could not remain disabled during primary startup."
        :error $ocholaVpnChildError
    }
}
:put "${tag}: STEP 3/10 complete - OpenVPN client configured."
}

# Keep the backup disconnected during normal operation. The scheduler is
# independent of this import so it can recover the management path later.
${hasBackupManagementVpn ? `/system scheduler
:do { remove [find where name="${failoverSchedulerName}"] } on-error={}
:do {
    add name="${failoverSchedulerName}" interval=00:00:15 start-time=startup on-event={
        :local primaryIds [/interface ovpn-client find where name="${interfaceName}"]
        :local backupIds [/interface ovpn-client find where name="${backupInterfaceName}"]
        :local primaryRunning false
        :if ([:len $primaryIds] > 0) do={
            :if ([/interface ovpn-client get [:pick $primaryIds 0] running] = true) do={ :set primaryRunning true }
        }
        :if ([:len $backupIds] > 0) do={
            :local backupId [:pick $backupIds 0]
            :local backupDisabled [/interface ovpn-client get $backupId disabled]
            :if (!$primaryRunning) do={
                :if ($backupDisabled = true) do={
                    :do { /interface ovpn-client set $backupId disabled=no } on-error={}
                    :log warning "${tag}: primary management VPN is down; backup management VPN enabled."
                }
            } else={
                :if ($backupDisabled = false) do={
                    :do { /interface ovpn-client set $backupId disabled=yes } on-error={}
                    :log info "${tag}: primary management VPN restored; backup management VPN disabled."
                }
            }
        }
    }
} on-error={
    :set ocholaVpnChildError "${tag}: RouterOS could not install the management VPN failover scheduler."
    :error $ocholaVpnChildError
}
:put "${tag}: Primary-first management VPN failover scheduler is active."` : ""}

:put "${tag}: OpenVPN client created (cipher=${openVpnCipher}, protocol=tcp); waiting up to 60s for the primary tunnel..."
:local ovpnRunning false
:for attempt from=1 to=12 do={
    :if (!$ovpnRunning) do={
        :delay 5s
        :if ([:len [/interface ovpn-client find where name="${interfaceName}" && running=yes]] > 0) do={
            :set ovpnRunning true
        }
    }
}
:if (!$ovpnRunning && ${hasBackupManagementVpn ? "true" : "false"}) do={
    :put "${tag}: Primary management VPN did not start; enabling the backup management VPN."
    :do { /interface ovpn-client set [find where name="${backupInterfaceName}"] disabled=no } on-error={
        :set ocholaVpnChildError "${tag}: backup management OpenVPN client could not be enabled after primary failure."
        :error $ocholaVpnChildError
    }
    :for attempt from=1 to=12 do={
        :if (!$ovpnRunning) do={
            :delay 5s
            :if ([:len [/interface ovpn-client find where name="${backupInterfaceName}" && running=yes]] > 0) do={
                :set ovpnRunning true
            }
        }
    }
}
:if (!$ovpnRunning) do={
    :put "${tag}: OpenVPN did not reach running=yes before the 60s timeout."
    :put "${tag}: Safe interface diagnostics (credentials are intentionally omitted):"
    :do {
        :local ovpnIds [/interface ovpn-client find where name="${interfaceName}"]
        :if ([:len $ovpnIds] = 0 && ${hasBackupManagementVpn ? "true" : "false"}) do={
            :set ovpnIds [/interface ovpn-client find where name="${backupInterfaceName}"]
        }
        :if ([:len $ovpnIds] > 0) do={
            :local ovpnId [:pick $ovpnIds 0]
            :put ("  name=" . [/interface ovpn-client get $ovpnId name] . " running=" . [/interface ovpn-client get $ovpnId running] . " disabled=" . [/interface ovpn-client get $ovpnId disabled] . " connect-to=" . [/interface ovpn-client get $ovpnId connect-to] . " port=" . [/interface ovpn-client get $ovpnId port])
        } else={
            :put "  interface was not found after the add command."
        }
    } on-error={ :put "${tag}: could not read the OpenVPN interface state." }
    :put "${tag}: Recent RouterOS OpenVPN log entries (if supported):"
    :do { /log print where topics~"ovpn" } on-error={ :put "${tag}: RouterOS did not expose filtered OpenVPN logs." }
    :set ocholaVpnChildError "${tag}: OVPN client did not establish a running session within 60 seconds. Review the safe interface diagnostics and OpenVPN log output above for reachability, TLS, authentication, certificate, or server-readiness errors."
    :error $ocholaVpnChildError
} else={
    :put "${tag}: Management OpenVPN client is running."
}

# Step 3: Continue after the management tunnel is running.
${minimalManagementSetup ? `# Core firewall and NAT rules are delivered separately in networksetup.rsc.
# The management API allow rule is installed here because Step 9 verifies
# RouterOS API reachability before networksetup.rsc is normally imported.
:put "${tag}: STEP 4/10 - Preparing management API firewall access."
${firewallPreparation}
:put "${tag}: STEP 4/10 complete - management API firewall access ready; core firewall and NAT remain in networksetup.rsc."` : `# Allow API access from the validated VPN peer.
# Only the configured VPS tunnel gateway may reach RouterOS API ports.
:put "${tag}: STEP 4/10 - Applying management firewall rules."
/ip firewall filter
${firewallPreparation}
:put "${tag}: STEP 4/10 complete - management firewall rules ready."`}
${bridgeSetup}
:if ([:len "${safeBridgeName}"] = 0) do={ :put "${tag}: STEP 5/10 skipped - no hotspot bridge was requested." }
${minimalManagementSetup ? `:put "${tag}: STEP 6/10 - Creating the protected OcholaSupernet API account."
${managementApiUserSetup}
:put "${tag}: STEP 6/10 complete - OcholaSupernet API account verified."` : safeApiUsernames.length > 0 ? `:put "${tag}: STEP 6/10 - Creating or reconciling management API accounts."
${apiUserSetup}
:put "${tag}: STEP 6/10 complete - management API accounts verified."` : `:put "${tag}: STEP 6/10 skipped - no management API account was requested."`}
:put "${tag}: STEP 7/10 - Preparing RouterOS API access."
${minimalManagementSetup ? `# Enable the RouterOS API service and allow the isolated API source networks.
/ip service
:do { /ip service set [find where name="api"] disabled=no address=${routerOsString(apiNetworkCsv)} } on-error={
    :set ocholaVpnChildError "${tag}: RouterOS API service could not be enabled."
    :error $ocholaVpnChildError
}
:do { /ip service set [find where name="api-ssl"] disabled=no address=${routerOsString(apiNetworkCsv)} } on-error={}` : `${natSetup}

# Step 7: Ensure API service is enabled and restricted
/ip service
:do { /ip service set [find where name="api"] disabled=no address=${routerOsString(apiServiceAddresses)} } on-error={
    :set ocholaVpnChildError "${tag}: could not restrict the RouterOS API service to the management VPN peer."
    :error $ocholaVpnChildError
}
:do { /ip service set [find where name="api-ssl"] disabled=no address=${routerOsString(apiServiceAddresses)} } on-error={}`}
:put "${tag}: STEP 7/10 complete - RouterOS API service is ready."

# Step 8: Discover and report the live tunnel IPv4
:put "${tag}: STEP 8/10 - Discovering the live management tunnel address."
:local activeInterface "${interfaceName}"
:if ([:len [/interface ovpn-client find where name="${interfaceName}" && running=yes]] = 0 && ${hasBackupManagementVpn ? "true" : "false"}) do={
    :if ([:len [/interface ovpn-client find where name="${backupInterfaceName}" && running=yes]] > 0) do={
        :set activeInterface "${backupInterfaceName}"
        :put "${tag}: Primary tunnel is down; using the backup management tunnel."
    }
}
:local ovpnId [/interface ovpn-client find where name=$activeInterface]
:local liveTunnelIp ""
:if ([:len $ovpnId] > 0) do={
    :local addressRows [/ip address find where interface=$activeInterface]
    :foreach addressId in=$addressRows do={
        :local addressValue [/ip address get $addressId address]
        :if ($addressValue ~ "^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+/") do={
            :set liveTunnelIp [:pick $addressValue 0 [:find $addressValue "/"]]
        }
    }
}
:if ([:len $liveTunnelIp] = 0) do={
    :set ocholaVpnChildError "${tag}: OpenVPN is running but no valid tunnel IPv4 was assigned."
    :error $ocholaVpnChildError
}
:put ("${tag}: STEP 8/10 complete - live tunnel IPv4 is " . $liveTunnelIp . " via " . $activeInterface . ".")

# Step 9: Verify RouterOS API reachability and backend registration
:put "${tag}: STEP 9/10 - Verifying RouterOS API and registering the live tunnel."
:local apiReachable false
:do {
    :local apiIds [/ip service find where name="api" && disabled=no]
    :if ([:len $apiIds] > 0) do={ :set apiReachable true }
} on-error={}
:if (!$apiReachable) do={
    :set ocholaVpnChildError "${tag}: tunnel IPv4 $liveTunnelIp is present but RouterOS API is not enabled."
    :error $ocholaVpnChildError
}
:local registrationUrl ${routerOsString(safeBackendRegistrationUrl)}
:set registrationUrl ($registrationUrl . "?ip=" . $liveTunnelIp)
:local registrationError ""
:do {
    /tool fetch url=$registrationUrl keep-result=no mode=https check-certificate=yes
} on-error={
    :do { :set registrationError $error } on-error={}
    :if ([:len $registrationError] > 0) do={
        :set ocholaVpnChildError ("${tag}: live tunnel IPv4 was found, but authenticated backend registration failed: " . $registrationError)
    } else={
        :set ocholaVpnChildError "${tag}: live tunnel IPv4 was found, but authenticated backend registration failed."
    }
    :error $ocholaVpnChildError
}
:put ("${tag}: backend registration accepted for live tunnel IPv4 " . $liveTunnelIp . " via " . $activeInterface)
:put ("${tag}: backend must now verify RouterOS API reachability at " . $liveTunnelIp . ":8728 before promotion.")
:put "${tag}: STEP 9/10 complete - backend registration accepted."

:log info ("${tag}: OVPN client running via " . $activeInterface . "; dynamic tunnel IPv4=" . $liveTunnelIp . "; backend API verification pending")
# Step 10: Hotspot assets
${hotspotAssetInstall}
`;
}
function generateRouterManagementVpnScript(opts) {
  return generateRouterAsClientScript({
    ...opts,
    autoDetectRouterOsMajor: true,
    minimalManagementSetup: true
  }).trim() + "\n";
}
function generateRouterWireGuardClientScript(opts) {
  const {
    endpoint,
    endpointPort = 51820,
    serverPublicKey,
    clientPrivateKey,
    tunnelRouterIp = "10.8.5.2",
    tunnelVpsIp = "10.8.5.1",
    routerId,
    installationMode = "coexist"
  } = opts;
  const coexistence = installationMode === "coexist";
  const tag = coexistence && routerId ? `ochola-mgmt-wg-${routerId}` : "corebillingvpn";
  const interfaceName = coexistence && routerId ? `ochola-mgmt-wg-${routerId}` : "ochola-wg";
  const preparation = coexistence ? `:if ([:len [/interface wireguard find where name="${interfaceName}"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 ${interfaceName} already exists."; :error $ocholaVpnChildError }
:if ([:len [/interface wireguard peers find where comment="${tag} WireGuard management peer"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 the required WireGuard peer already exists."; :error $ocholaVpnChildError }
:if ([:len [/ip firewall filter find where comment="${tag}-api-from-vpn-tunnel"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 the required WireGuard API firewall rule already exists."; :error $ocholaVpnChildError }` : `:do { /interface wireguard peers remove [find where comment="${tag} WireGuard management peer"] } on-error={}
:do { /ip address remove [find interface="${interfaceName}"] } on-error={}
:do { /interface wireguard remove [find where name="${interfaceName}"] } on-error={}`;
  const firewall = coexistence ? `:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: coexistence API firewall rule creation failed."; :error $ocholaVpnChildError }` : `:do { /ip firewall filter remove [find where comment="${tag}-api-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard API firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }
:do { /ip firewall filter remove [find where comment="${tag}-ping-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=icmp comment="${tag}-ping-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard ping firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }`;
  return `# ${tag} \u2014 MikroTik RouterOS 7 WireGuard management client
# This child script is fetched only after the OpenVPN attempt fails.
# RouterOS 6 devices must not import this file.

:put "${tag}: configuring WireGuard fallback..."
:global ocholaVpnChildError
:set ocholaVpnChildError ""
${preparation}
:do { /interface wireguard add name="${interfaceName}" private-key="${clientPrivateKey}" disabled=no comment="${tag} WireGuard management" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard interface creation failed: RouterOS rejected the interface command." ; :error $ocholaVpnChildError }
:do { /ip address add address=${tunnelRouterIp}/24 interface="${interfaceName}" comment="${tag} WireGuard management address" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard address creation failed: RouterOS rejected the address command." ; :error $ocholaVpnChildError }
:do { /interface wireguard peers add interface="${interfaceName}" public-key="${serverPublicKey}" endpoint-address="${endpoint}" endpoint-port=${endpointPort} allowed-address=${tunnelVpsIp}/32 persistent-keepalive=25 comment="${tag} WireGuard management peer" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard peer creation failed: RouterOS rejected the peer command." ; :error $ocholaVpnChildError }
${firewall}
:delay 5s
:if ([:len [/interface wireguard find where name="${interfaceName}"]] = 0) do={ :set ocholaVpnChildError "${tag}: WireGuard interface was not verified."; :error $ocholaVpnChildError }
:put "${tag}: WireGuard management resources verified."
:log info "${tag}: WireGuard fallback configured via ${endpoint}:${endpointPort}"
`;
}
function generateRouterIpsecClientScript(opts) {
  const {
    endpoint,
    preSharedKey,
    tunnelRouterIp = "10.8.5.2",
    tunnelVpsIp = "10.8.5.1",
    routerId,
    routerOsMajor = 6,
    installationMode = "coexist"
  } = opts;
  const routerOs7 = routerOsMajor >= 7;
  const routerOsPath = routerOs7 ? "RouterOS 7+" : "RouterOS 6";
  const coexistence = installationMode === "coexist";
  const tag = coexistence && routerId ? `ochola-mgmt-ipsec-${routerId}` : "corebillingvpn";
  const peerName = `ochola-ipsec-${routerId ?? "management"}`;
  const identityIds = routerId ? ` my-id=fqdn:router-${routerId} remote-id=fqdn:ochola-router-${routerId}-server` : "";
  const safePreSharedKey = preSharedKey.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const preparation = coexistence ? `:if ([:len [/ip ipsec peer find where name="${peerName}"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 ${peerName} already exists."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec peer find where comment="${tag} IPsec management peer"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 the required IPsec peer already exists."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec policy find where comment="${tag} IPsec management policy"]] > 0) do={ :set ocholaVpnChildError "${tag}: coexistence conflict \u2014 the required IPsec policy already exists."; :error $ocholaVpnChildError }` : `:do { /ip ipsec policy remove [find where comment="${tag} IPsec management policy"] } on-error={}
:do { /ip ipsec identity remove [find where comment="${tag} IPsec management identity"] } on-error={}
:do { /ip ipsec peer remove [find where comment="${tag} IPsec management peer"] } on-error={}`;
  const firewall = coexistence ? `:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: coexistence API firewall rule creation failed."; :error $ocholaVpnChildError }` : `:do { /ip firewall filter remove [find where comment="${tag}-api-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: IPsec API firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }`;
  const ipsecOptionalSettings = routerOs7 ? `# RouterOS 7 path: apply the optional initial-contact setting only after
# the broadly compatible peer exists.
:do {
    /ip ipsec peer set [find where name="${peerName}"] send-initial-contact=yes
} on-error={ :put "${tag}: optional RouterOS 7 IPsec initial-contact setting was not accepted; continuing with the verified peer." }` : `# RouterOS 6 path: keep the peer command to the conservative common property set.
# RouterOS 7-only IPsec properties are intentionally absent from this child.`;
  const ipsecVariantNote = routerOs7 ? `# RouterOS 7 path: use the common IKEv2 peer first, then apply optional settings.` : `# RouterOS 6 path: use the conservative IKEv2 peer property set.`;
  return `# ${tag} \u2014 MikroTik ${routerOsPath} IPsec management fallback
# This child script is attempted only after OpenVPN and WireGuard fail.
# IPsec is policy-based, so verification confirms the peer, identity and policy
# resources; the authenticated heartbeat must confirm end-to-end reachability.
# VERSION PATH: ${routerOsPath}

:put "${tag}: configuring IPsec fallback..."
:global ocholaVpnChildError
:set ocholaVpnChildError ""
${preparation}
${ipsecVariantNote}
:do { /ip ipsec peer add name="${peerName}" address=${endpoint} exchange-mode=ike2 disabled=no comment="${tag} IPsec management peer" } on-error={ :set ocholaVpnChildError "${tag}: IPsec peer creation failed: RouterOS rejected the peer command." ; :error $ocholaVpnChildError }
${ipsecOptionalSettings}
:do { /ip ipsec identity add peer="${peerName}" auth-method=pre-shared-key secret="${safePreSharedKey}"${identityIds} comment="${tag} IPsec management identity" } on-error={ :set ocholaVpnChildError "${tag}: IPsec identity creation failed: RouterOS rejected the identity command." ; :error $ocholaVpnChildError }
:do { /ip ipsec policy add src-address=${tunnelRouterIp}/32 dst-address=${tunnelVpsIp}/32 tunnel=yes sa-src-address=0.0.0.0 sa-dst-address=${endpoint} proposal=default comment="${tag} IPsec management policy" } on-error={ :set ocholaVpnChildError "${tag}: IPsec policy creation failed: RouterOS rejected the policy command." ; :error $ocholaVpnChildError }
${firewall}
:if ([:len [/ip ipsec peer find where comment="${tag} IPsec management peer"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec peer was not verified."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec identity find where comment="${tag} IPsec management identity"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec identity was not verified."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec policy find where comment="${tag} IPsec management policy"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec policy was not verified."; :error $ocholaVpnChildError }
:put "${tag}: IPsec management resources verified; waiting for authenticated heartbeat."
:log info "${tag}: IPsec fallback configured via ${endpoint}"
`;
}
var DEFAULT_ROUTER_API_NETWORKS = [
  "10.8.0.0/24",
  "10.8.5.0/24",
  "10.8.6.0/24"
];
function generateNetworkSetupScript(options = {}) {
  const { routerId, apiNetworks = DEFAULT_ROUTER_API_NETWORKS } = options;
  const tag = `ochola-network-${routerId ?? "router"}`;
  const safeNetworks = Array.from(new Set(apiNetworks)).filter(
    (network) => /^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12]\d|3[0-2])$/.test(network)
  );
  if (safeNetworks.length === 0) {
    throw new Error("At least one valid RouterOS API network is required.");
  }
  const apiRules = safeNetworks.map((network, index) => `:do { /ip firewall filter remove [find where comment="${tag}-api-${index}"] } on-error={}
:local ocholaApiRuleError${index} ""
:local ocholaApiRuleId${index} ""
:do {
    :set ocholaApiRuleId${index} [/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728,8729 src-address=${network} comment="${tag}-api-${index}"]
    /ip firewall filter move $ocholaApiRuleId${index} destination=0
} on-error={
    :set ocholaApiRuleError${index} $error
}
:if ([:len $ocholaApiRuleError${index}] > 0) do={
    :put ("${tag}: could not add API allow rule for ${network}: " . $ocholaApiRuleError${index})
}`).join("\n");
  return `# ===============================================================
# OcholaSupernet - networksetup.rsc
# Core firewall and NAT engine for the router
# Generated  : ${(/* @__PURE__ */ new Date()).toISOString()}
#
# This file is intentionally separate from vpnsetup.rsc.
# It only replaces rules carrying the ${tag} comments.
# API source networks: ${safeNetworks.join(", ")}
# ===============================================================

:put "${tag}: starting core firewall and NAT setup."
/ip firewall filter

# Stateful baseline rules. These are safe to retry and do not delete
# unrelated firewall policy.
:do { remove [find where comment="${tag}-established-input"] } on-error={}
:do { add chain=input action=accept connection-state=established,related comment="${tag}-established-input" place-before=0 } on-error={}
:do { remove [find where comment="${tag}-invalid-input"] } on-error={}
:do { add chain=input action=drop connection-state=invalid comment="${tag}-invalid-input" place-before=0 } on-error={}
:do { remove [find where comment="${tag}-established-forward"] } on-error={}
:do { add chain=forward action=accept connection-state=established,related comment="${tag}-established-forward" place-before=0 } on-error={}
:do { remove [find where comment="${tag}-invalid-forward"] } on-error={}
:do { add chain=forward action=drop connection-state=invalid comment="${tag}-invalid-forward" place-before=0 } on-error={}

# Allow the management and legacy API pools before any existing WAN policy.
${apiRules}

# Permit ordinary LAN-to-WAN forwarding only when the standard interface
# lists exist; Hotspot clients must be authenticated before they can use
# this path. The non-Hotspot rule keeps ordinary LAN clients working.
:local ocholaLanLists [/interface list find where name="LAN"]
:local ocholaWanLists [/interface list find where name="WAN"]
:if ([:len $ocholaLanLists] > 0 && [:len $ocholaWanLists] > 0) do={
    :do { /ip firewall filter remove [find where comment="${tag}-lan-to-wan"] } on-error={}
    :do { /ip firewall filter remove [find where comment="${tag}-lan-hotspot-auth"] } on-error={}
    :do { /ip firewall filter add chain=forward action=accept in-interface-list=LAN out-interface-list=WAN hotspot=auth comment="${tag}-lan-hotspot-auth" } on-error={
        :put "${tag}: could not add authenticated Hotspot LAN-to-WAN rule."
    }
    :do { /ip firewall filter add chain=forward action=accept in-interface-list=LAN out-interface-list=WAN hotspot=!from-client comment="${tag}-lan-to-wan" } on-error={
        :put "${tag}: could not add LAN-to-WAN forward rule."
    }
} else={
    :put "${tag}: LAN/WAN interface lists are not both present; existing forwarding policy was preserved."
}

# Masquerade outbound traffic through the standard WAN interface list.
/ip firewall nat
:if ([:len $ocholaWanLists] > 0) do={
    :do { remove [find where comment="${tag}-wan-masquerade"] } on-error={}
    :do { add chain=srcnat action=masquerade out-interface-list=WAN comment="${tag}-wan-masquerade" } on-error={
        :put "${tag}: could not add the WAN masquerade rule."
    }
} else={
    :put "${tag}: WAN interface list is not present; existing NAT policy was preserved."
}

:put "${tag}: core firewall and NAT setup complete."
`;
}
function validateCoexistenceRadiusIp(value) {
  const endpoint = String(value ?? "").trim();
  if (!endpoint || endpoint.length > 255 || !/^[A-Za-z0-9:._-]+$/.test(endpoint)) {
    throw new Error("Coexistence RADIUS address must be a hostname or IP address.");
  }
  return endpoint;
}
function validateCoexistenceRadiusSecret(value) {
  const secret = String(value ?? "");
  if (!secret || /[\u0000-\u001F\u007F"]/u.test(secret)) {
    throw new Error("Coexistence RADIUS secret is empty or contains unsafe characters.");
  }
  return secret;
}
function generateCoexistenceServiceSetupScript(options) {
  const routerTag = options.routerId == null ? "router" : String(options.routerId);
  const tag = `ochola-coexist-${routerTag}`;
  const bridgeName = validateRouterOsResourceName(
    options.bridgeName ?? "br-ochola-coexist",
    "Coexistence bridge name"
  );
  const bridgePorts = Array.from(new Set((options.bridgePorts ?? []).map((port) => validateRouterOsResourceName(port, "Coexistence bridge port"))));
  const portName = validateRouterOsResourceName(
    options.portName ?? bridgePorts[0] ?? "service",
    "Coexistence port name"
  );
  const radiusIp = options.radiusIp ? validateCoexistenceRadiusIp(options.radiusIp) : "";
  const radiusSecret = options.radiusSecret ? validateCoexistenceRadiusSecret(options.radiusSecret) : "";
  if (radiusIp && !radiusSecret || !radiusIp && radiusSecret) {
    throw new Error("Coexistence RADIUS configuration must include both address and secret.");
  }
  const bridgeComment = `${tag} owned bridge`;
  const portComment = `${tag} owned port`;
  const poolComment = `${tag} owned pool`;
  const dhcpComment = `${tag} owned DHCP network`;
  const profileComment = `${tag} owned Hotspot profile`;
  const pppoeProfileComment = `${tag} owned PPPoE profile`;
  const radiusComment = "Ochola Platform Link - Coexist Mode";
  const hotspotDirectory = `flash/hotspot/coexist_hs_${portName}`;
  const hotspotPool = `${tag}-pool`;
  const dhcpServer = `${tag}-dhcp`;
  const hotspotProfile = `${tag}-hotspot-profile`;
  const hotspotServer = `coexist_hs_${portName}`;
  const pppoePool = `${tag}-pppoe-pool`;
  const pppoeProfile = `${tag}-pppoe-profile`;
  const pppoeService = `pppoe_ochola_${portName}`;
  const hotspotGateway = "172.16.99.1/24";
  const coexistNetwork = "172.16.99.0/24";
  const poolRange = "172.16.99.10-172.16.99.254";
  const ownedOrConflict = (variableName, findPath, findClause, resourceName, comment, command) => `:local ${variableName}Ids [${findPath} find where ${findClause}]
:if ([:len $${variableName}Ids] = 0) do={
    ${command}
} else={
    :local ${variableName}Id [:pick $${variableName}Ids 0]
    :local ${variableName}Comment [${findPath} get $${variableName}Id comment]
    :if ($${variableName}Comment != ${routerOsString(comment)}) do={
        :set coexistError ("${tag}: foreign resource named " . ${routerOsString(resourceName)} . " was preserved.")
        :error $coexistError
    }
}`;
  const blocks = [];
  blocks.push(`# 1. Isolated coexistence bridge
:if ([:len [/interface bridge find where name=${routerOsString(bridgeName)}]] = 0) do={
    :do {
        /interface bridge add name=${routerOsString(bridgeName)} comment=${routerOsString(bridgeComment)}
    } on-error={
        :set coexistError ("${tag}: coexistence bridge creation failed: " . $error)
        :error $coexistError
    }
}
:if ([:len [/interface bridge find where name=${routerOsString(bridgeName)}]] = 0) do={
    :set coexistError "${tag}: coexistence bridge was not verified."
    :error $coexistError
}`);
  if (bridgePorts.length > 0) {
    blocks.push(`# 2. Attach only unassigned mapped ports; foreign bridge membership is never moved
${bridgePorts.map((port, index) => `:if ([:len [/interface find where name=${routerOsString(port)}]] = 0) do={
    :set coexistError "${tag}: mapped port ${port} was not found and was not changed."
    :error $coexistError
}
:local coexistPortIds${index} [/interface bridge port find where interface=${routerOsString(port)}]
:if ([:len $coexistPortIds${index}] = 0) do={
    :do {
        /interface bridge port add bridge=${routerOsString(bridgeName)} interface=${routerOsString(port)} comment=${routerOsString(portComment)}
    } on-error={
        :set coexistError ("${tag}: mapped port ${port} could not be attached: " . $error)
        :error $coexistError
    }
} else={
    :local coexistPortId${index} [:pick $coexistPortIds${index} 0]
    :local coexistPortBridge${index} [/interface bridge port get $coexistPortId${index} bridge]
    :if ($coexistPortBridge${index} != ${routerOsString(bridgeName)}) do={
        :set coexistError ("${tag}: mapped port ${port} belongs to foreign bridge " . $coexistPortBridge${index} . "; it was preserved.")
        :error $coexistError
    }
}`).join("\n")}`);
  }
  blocks.push(`# 3. Isolated gateway and DHCP resources
:if ([:len [/ip address find where address=${routerOsString(hotspotGateway)}]] = 0) do={
    :do {
        /ip address add address=${routerOsString(hotspotGateway)} interface=${routerOsString(bridgeName)} comment=${routerOsString(`${tag} gateway`)}
    } on-error={
        :set coexistError ("${tag}: isolated gateway creation failed: " . $error)
        :error $coexistError
    }
} else={
    :if ([:len [/ip address find where address=${routerOsString(hotspotGateway)} && interface=${routerOsString(bridgeName)}]] = 0) do={
        :set coexistError "${tag}: 172.16.99.1/24 is already assigned to another interface; it was preserved."
        :error $coexistError
    }
}
:if ([:len [/ip pool find where name=${routerOsString(hotspotPool)}]] = 0) do={
    :do {
        /ip pool add name=${routerOsString(hotspotPool)} ranges=${routerOsString(poolRange)} comment=${routerOsString(poolComment)}
    } on-error={
        :set coexistError ("${tag}: isolated DHCP pool creation failed: " . $error)
        :error $coexistError
    }
} else={
    :if ([:len [/ip pool find where name=${routerOsString(hotspotPool)} && comment=${routerOsString(poolComment)}]] = 0) do={
        :set coexistError "${tag}: a foreign DHCP pool already uses the coexistence pool name; it was preserved."
        :error $coexistError
    }
}
:if ([:len [/ip dhcp-server network find where address=${routerOsString(coexistNetwork)}]] = 0) do={
    :do {
        /ip dhcp-server network add address=${routerOsString(coexistNetwork)} gateway=${routerOsString("172.16.99.1")} dns-server=${routerOsString("172.16.99.1")} comment=${routerOsString(dhcpComment)}
    } on-error={
        :set coexistError ("${tag}: isolated DHCP network creation failed: " . $error)
        :error $coexistError
    }
}
${ownedOrConflict(
    "coexistDhcp",
    "/ip dhcp-server",
    `name=${routerOsString(dhcpServer)}`,
    dhcpServer,
    dhcpComment,
    `/ip dhcp-server add name=${routerOsString(dhcpServer)} interface=${routerOsString(bridgeName)} address-pool=${routerOsString(hotspotPool)} disabled=no comment=${routerOsString(dhcpComment)}`
  )}`);
  blocks.push(`# 4. Isolated Hotspot files, profile, and server
:if ([:len [/file find where name=${routerOsString(hotspotDirectory)}]] = 0) do={
    :do { /file make-dir dir-name=${routerOsString(hotspotDirectory)} } on-error={
        :set coexistError ("${tag}: Hotspot directory creation failed: " . $error)
        :error $coexistError
    }
}
:if ([:len [/file find where name=${routerOsString(hotspotDirectory)}]] = 0) do={
    :set coexistError "${tag}: Hotspot directory was not verified."
    :error $coexistError
}
${ownedOrConflict(
    "coexistHotspotProfile",
    "/ip hotspot profile",
    `name=${routerOsString(hotspotProfile)}`,
    hotspotProfile,
    profileComment,
    `/ip hotspot profile add name=${routerOsString(hotspotProfile)} hotspot-address=${routerOsString("172.16.99.1")} html-directory=${routerOsString(hotspotDirectory)} login-by=${routerOsString("http-chap,http-pap,cookie")} use-radius=yes comment=${routerOsString(profileComment)}`
  )}
${ownedOrConflict(
    "coexistHotspotServer",
    "/ip hotspot",
    `name=${routerOsString(hotspotServer)}`,
    hotspotServer,
    `${tag} owned Hotspot server`,
    `/ip hotspot add name=${routerOsString(hotspotServer)} interface=${routerOsString(bridgeName)} profile=${routerOsString(hotspotProfile)} address-pool=${routerOsString(hotspotPool)} disabled=no comment=${routerOsString(`${tag} owned Hotspot server`)}`
  )}`);
  blocks.push(`# 5. Isolated PPPoE pool, profile, and server
${ownedOrConflict(
    "coexistPppoePool",
    "/ip pool",
    `name=${routerOsString(pppoePool)}`,
    pppoePool,
    `${tag} owned PPPoE pool`,
    `/ip pool add name=${routerOsString(pppoePool)} ranges=${routerOsString(poolRange)} comment=${routerOsString(`${tag} owned PPPoE pool`)}`
  )}
${ownedOrConflict(
    "coexistPppoeProfile",
    "/ppp profile",
    `name=${routerOsString(pppoeProfile)}`,
    pppoeProfile,
    pppoeProfileComment,
    `/ppp profile add name=${routerOsString(pppoeProfile)} local-address=${routerOsString("172.16.99.1")} remote-address=${routerOsString(pppoePool)} use-radius=yes only-one=yes comment=${routerOsString(pppoeProfileComment)}`
  )}
${ownedOrConflict(
    "coexistPppoeServer",
    "/interface pppoe-server server",
    `service-name=${routerOsString(pppoeService)}`,
    pppoeService,
    `${tag} owned PPPoE server`,
    `/interface pppoe-server server add service-name=${routerOsString(pppoeService)} interface=${routerOsString(bridgeName)} default-profile=${routerOsString(pppoeProfile)} one-session-per-host=yes disabled=no comment=${routerOsString(`${tag} owned PPPoE server`)}`
  )}`);
  if (radiusIp && radiusSecret) {
    blocks.push(`# 6. Append the platform RADIUS profile without removing any existing entries
:if ([:len [/radius find where service=${routerOsString("hotspot,ppp")} && address=${routerOsString(radiusIp)} && disabled=no]] = 0) do={
    :do {
        /radius add service=${routerOsString("hotspot,ppp")} address=${routerOsString(radiusIp)} secret=${routerOsString(radiusSecret)} authentication-port=1812 accounting-port=1813 comment=${routerOsString(radiusComment)}
    } on-error={
        :set coexistError ("${tag}: platform RADIUS profile could not be added: " . $error)
        :error $coexistError
    }
}
:if ([:len [/radius find where service=${routerOsString("hotspot,ppp")} && address=${routerOsString(radiusIp)} && disabled=no]] = 0) do={
    :set coexistError "${tag}: platform RADIUS profile was not verified."
    :error $coexistError
}`);
  } else {
    blocks.push(`# 6. RADIUS was not changed because no platform address and secret were supplied
:put "${tag}: platform RADIUS profile skipped; existing RADIUS entries were preserved."`);
  }
  blocks.push(`# 7. Enable CoA on the RouterOS RADIUS listener, changing only the required fields
:local coexistRadiusIncomingIds [/radius incoming find]
:if ([:len $coexistRadiusIncomingIds] > 0) do={
    :local coexistRadiusIncomingId [:pick $coexistRadiusIncomingIds 0]
    :if ([/radius incoming get $coexistRadiusIncomingId accept] != true) do={
        :do { /radius incoming set $coexistRadiusIncomingId accept=yes } on-error={
            :set coexistError ("${tag}: inbound RADIUS CoA could not be enabled: " . $error)
            :error $coexistError
        }
    }
    :if ([/radius incoming get $coexistRadiusIncomingId port] != 3799) do={
        :do { /radius incoming set $coexistRadiusIncomingId port=3799 } on-error={
            :set coexistError ("${tag}: inbound RADIUS CoA port could not be set to 3799: " . $error)
            :error $coexistError
        }
    }
}
:if ([:len [/radius incoming find where accept=yes && port=3799]] = 0) do={
    :set coexistError "${tag}: inbound RADIUS CoA listener was not verified on UDP 3799."
    :error $coexistError
}`);
  blocks.push(`# 8. Scoped forwarding, DNS, and NAT for the isolated virtual plane
:if ([:len [/interface list find where name="WAN"]] > 0) do={
    :if ([:len [/ip firewall filter find where comment=${routerOsString(`${tag} to-wan`)}]] = 0) do={
        :do { /ip firewall filter add chain=forward action=accept src-address=${routerOsString(coexistNetwork)} out-interface-list=WAN connection-state=new,established,related comment=${routerOsString(`${tag} to-wan`)} place-before=0 } on-error={
            :set coexistError ("${tag}: isolated WAN forwarding rule could not be added: " . $error)
            :error $coexistError
        }
    }
    :if ([:len [/ip firewall nat find where comment=${routerOsString(`${tag} masquerade`)}]] = 0) do={
        :do { /ip firewall nat add chain=srcnat action=masquerade src-address=${routerOsString(coexistNetwork)} out-interface-list=WAN comment=${routerOsString(`${tag} masquerade`)} } on-error={
            :set coexistError ("${tag}: isolated NAT rule could not be added: " . $error)
            :error $coexistError
        }
    }
}
:if ([:len [/ip firewall filter find where comment=${routerOsString(`${tag} allow-dns`)}]] = 0) do={
    :do { /ip firewall filter add chain=input action=accept in-interface=${routerOsString(bridgeName)} protocol=udp dst-port=53 comment=${routerOsString(`${tag} allow-dns`)} place-before=0 } on-error={
        :set coexistError ("${tag}: isolated DNS rule could not be added: " . $error)
        :error $coexistError
    }
}`);
  const renderedBlocks = blocks.map((block, index) => `${block.trim()}${index < blocks.length - 1 ? "\n:delay 2s;" : ""}`).join("\n\n");
  return `# ===============================================================
# OcholaSupernet - Brownfield Coexistence service plane
# Generated  : ${(/* @__PURE__ */ new Date()).toISOString()}
# This payload is isolated from the existing billing system.
# It never resets bridges, interfaces, routes, or existing RADIUS entries.
# Port label : ${portName}
# Bridge     : ${bridgeName}
# ===============================================================

:global coexistError
:set coexistError ""
${renderedBlocks}
:put "${tag}: complete isolated coexistence service plane verified."
`;
}
function generateServiceSetupScript(options = {}) {
  if (options.installationMode === "coexist") {
    return generateCoexistenceServiceSetupScript(options);
  }
  const routerTag = options.routerId == null ? "router" : String(options.routerId);
  const tag = `ochola-services-${routerTag}`;
  const bridgeName = validateRouterOsResourceName(
    options.bridgeName ?? "hotspot-bridge",
    "Service bridge name"
  );
  const bridgePorts = Array.from(new Set((options.bridgePorts ?? []).map((port) => validateRouterOsResourceName(port, "Service bridge port"))));
  const maxPortSpeedMbps = options.maxPortSpeedMbps === void 0 ? void 0 : Number(options.maxPortSpeedMbps);
  if (maxPortSpeedMbps !== void 0 && (!Number.isFinite(maxPortSpeedMbps) || maxPortSpeedMbps <= 0 || maxPortSpeedMbps > 1e5)) {
    throw new Error("Service queue speed must be a positive value no greater than 100000 Mbps.");
  }
  const portalHostnames = Array.from(new Set((options.portalHostnames ?? []).map((host) => String(host).trim().toLowerCase()).filter((host) => host.length > 0 && host.length <= 253 && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host))));
  const paymentHostnames = Array.from(new Set((options.paymentHostnames ?? PAYMENT_WALLED_GARDEN_HOSTNAMES).map((host) => String(host).trim().toLowerCase()).filter((host) => host.length > 0 && host.length <= 253 && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)).filter((host) => !portalHostnames.includes(host))));
  const hotspotPool = SHARED_HOTSPOT_POOL_NAME;
  const pppoePool = `${tag}-pppoe-pool`;
  const pppoeProfile = `${tag}-pppoe-profile`;
  const hotspotProfile = SHARED_HOTSPOT_PROFILE_NAME;
  const hotspotServer = SHARED_HOTSPOT_SERVER_NAME;
  const legacyHotspot = legacySharedHotspotResourceNames(routerTag);
  const dhcpServer = `${tag}-dhcp`;
  const hotspotGateway = "192.168.180.1";
  const hotspotNetwork = "192.168.180.0/22";
  const pppoeGateway = "192.168.99.1";
  const pppoeNetwork = "192.168.99.0/24";
  const portalFileUrls = options.portalFileUrls ? {
    login: validateRouterOpenVpnCaUrl(options.portalFileUrls.login),
    roamingLogin: validateRouterOpenVpnCaUrl(options.portalFileUrls.roamingLogin),
    md5: validateRouterOpenVpnCaUrl(options.portalFileUrls.md5)
  } : null;
  const bridgePortSetup = bridgePorts.map((port, index) => `:local servicePortIds${index} [/interface bridge port find where interface=${routerOsString(port)}]
:if ([:len $servicePortIds${index}] > 0) do={
    :local servicePortId${index} [:pick $servicePortIds${index} 0]
    :local servicePortBridge${index} [/interface bridge port get $servicePortId${index} bridge]
    :if ($servicePortBridge${index} != ${routerOsString(bridgeName)}) do={
        :set serviceError ("${tag}: ${port} is already assigned to foreign bridge " . $servicePortBridge${index} . "; it was not moved.")
        :error $serviceError
    }
} else={
    :do { /interface bridge port add bridge=${routerOsString(bridgeName)} interface=${routerOsString(port)} comment=${routerOsString(`${tag} bridge port`)} } on-error={
        :set serviceError ("${tag}: could not add bridge port ${port}: " . $error)
        :error $serviceError
    }
}`).join("\n");
  const walledGardenEntries = [
    ...portalHostnames.map((hostname) => ({
      hostname,
      comment: `${tag} walled garden ${hostname}`
    })),
    ...paymentHostnames.map((hostname) => ({
      hostname,
      comment: `${tag} payment walled garden ${hostname}`
    }))
  ];
  const walledGardenSetup = walledGardenEntries.length > 0 ? walledGardenEntries.map(({ hostname, comment }) => `:do {
    /ip hotspot walled-garden ip add dst-host=${routerOsString(hostname)} action=accept comment=${routerOsString(comment)}
} on-error={
    :set serviceError ("${tag}: could not add walled-garden host ${hostname}: " . $error)
    :error $serviceError
}`).join("\n") : `:put "${tag}: no portal hostname was supplied; walled-garden host entries were not added."`;
  const queueSetup = maxPortSpeedMbps === void 0 ? `:put "${tag}: no aggregate queue speed was supplied; existing bandwidth policy was preserved."` : `# Optional, tagged hierarchy for this shared service wire.
:do { /queue simple remove [find where comment=${routerOsString(`${tag} queue`)}] } on-error={}
:do { /queue simple add name=${routerOsString(`${tag}-root`)} target=${routerOsString(bridgeName)} max-limit=${routerOsString(`${maxPortSpeedMbps}M/${maxPortSpeedMbps}M`)} priority=2/2 comment=${routerOsString(`${tag} queue`)} } on-error={
    :set serviceError ("${tag}: aggregate queue could not be created: " . $error)
    :error $serviceError
}
:do { /queue simple add name=${routerOsString(`${tag}-pppoe`)} target=${routerOsString(pppoeNetwork)} parent=${routerOsString(`${tag}-root`)} max-limit=${routerOsString(`${maxPortSpeedMbps}M/${maxPortSpeedMbps}M`)} priority=1/1 comment=${routerOsString(`${tag} queue`)} } on-error={
    :set serviceError ("${tag}: PPPoE queue could not be created: " . $error)
    :error $serviceError
}
:do { /queue simple add name=${routerOsString(`${tag}-hotspot`)} target=${routerOsString(hotspotNetwork)} parent=${routerOsString(`${tag}-root`)} max-limit=${routerOsString(`${Math.max(1, Math.floor(maxPortSpeedMbps * 0.4))}M/${Math.max(1, Math.floor(maxPortSpeedMbps * 0.4))}M`)} priority=8/8 comment=${routerOsString(`${tag} queue`)} } on-error={
    :set serviceError ("${tag}: Hotspot queue could not be created: " . $error)
    :error $serviceError
}`;
  return `# ===============================================================
# OcholaSupernet - servicessetup.rsc (Script 4)
# Shared Hotspot and PPPoE service layer
# Generated  : ${(/* @__PURE__ */ new Date()).toISOString()}
#
# Run after networksetup.rsc and vpnsetup.rsc.
# This file owns only OcholaSupernet-tagged service resources:
#   - service bridge and selected physical ports
 #   - Hotspot gateway, DHCP, pool, profile, and server
 #   - Hotspot walled garden for the portal/API and payment hostnames
#   - PPPoE gateway, pool, profile, and server
#   - customer NAT rules for both service networks
# Existing foreign bridge memberships and unowned resources are preserved.
# ===============================================================

:global serviceError
:set serviceError ""
:local serviceFailures ""
:local serviceStepFailed false
:put "${tag}: starting Hotspot and PPPoE service setup."
:put "${tag}: service steps: 1 portal files; 2 bridge; 3 gateways; 4 Hotspot; 5 walled garden; 6 PPPoE; 7 NAT."

# 1. Install the default RouterOS Hotspot files only when they are absent.
#    Existing tenant-branded files are never replaced by this bootstrap.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 1/7 - portal files starting."
:do {
    :do { /file make-dir dir-name="hotspot" } on-error={}
${portalFileUrls ? `:if ([:len [/file find where name="hotspot/login.html"]] = 0) do={
    :do { /tool fetch url=${routerOsString(portalFileUrls.login)} dst-path="hotspot/login.html" mode=https check-certificate=yes } on-error={
        :set serviceError ("${tag}: default Hotspot login.html could not be downloaded: " . $error)
        :error $serviceError
    }
}
:if ([:len [/file find where name="hotspot/rlogin.html"]] = 0) do={
    :do { /tool fetch url=${routerOsString(portalFileUrls.roamingLogin)} dst-path="hotspot/rlogin.html" mode=https check-certificate=yes } on-error={
        :set serviceError ("${tag}: default Hotspot rlogin.html could not be downloaded: " . $error)
        :error $serviceError
    }
}
:if ([:len [/file find where name="hotspot/md5.js"]] = 0) do={
    :do { /tool fetch url=${routerOsString(portalFileUrls.md5)} dst-path="hotspot/md5.js" mode=https check-certificate=yes } on-error={
        :set serviceError ("${tag}: Hotspot login helper md5.js could not be downloaded: " . $error)
        :error $serviceError
    }
}` : `:put "${tag}: no default portal sources were supplied; existing Hotspot files were left unchanged."`}
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 1/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 1/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 1/7 complete - portal files ready." }

# 2. Create the shared service bridge without taking ports away from another bridge.
 :set serviceStepFailed false
:put "${tag}: SERVICE STEP 2/7 - service bridge starting."
:do {
    :if ([:len [/interface bridge find where name=${routerOsString(bridgeName)}]] = 0) do={
        :do {
            /interface bridge add name=${routerOsString(bridgeName)}${bridgeName === "hotspot-bridge" ? "" : ` comment=${routerOsString(`${tag} service bridge`)}`}
        } on-error={
            :set serviceError ("${tag}: service bridge creation failed: " . $error)
            :error $serviceError
        }
    }
    ${bridgeName === "hotspot-bridge" ? `/interface bridge set [find where name=${routerOsString(bridgeName)}] comment=""` : ""}
    ${bridgePortSetup}
    :if ([:len [/interface bridge find where name=${routerOsString(bridgeName)}]] = 0) do={
        :set serviceError "${tag}: service bridge was not verified."
        :error $serviceError
    }
    :if ([:len [/interface list find where name="LAN"]] = 0) do={
        :do { /interface list add name="LAN" } on-error={
            :set serviceError ("${tag}: could not create the LAN interface list: " . $error)
            :error $serviceError
        }
    }
    :if ([:len [/interface list member find where list="LAN" && interface=${routerOsString(bridgeName)}]] = 0) do={
        :do { /interface list member add list="LAN" interface=${routerOsString(bridgeName)} } on-error={
            :set serviceError ("${tag}: could not add the service bridge to the LAN interface list: " . $error)
            :error $serviceError
        }
    }
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 2/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 2/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 2/7 complete - service bridge and selected ports ready." }

# 3. Add the Hotspot and PPPoE gateway addresses to the service bridge.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 3/7 - service gateways starting."
:do {
    :if ([:len [/ip address find where address=${routerOsString(`${hotspotGateway}/22`)} && interface=${routerOsString(bridgeName)}]] = 0) do={
        :do { /ip address add address=${routerOsString(`${hotspotGateway}/22`)} interface=${routerOsString(bridgeName)} comment=${routerOsString(`${tag} hotspot gateway`)} } on-error={
            :set serviceError ("${tag}: Hotspot gateway creation failed: " . $error)
            :error $serviceError
        }
    }
    :if ([:len [/ip address find where address=${routerOsString(`${pppoeGateway}/24`)} && interface=${routerOsString(bridgeName)}]] = 0) do={
        :do { /ip address add address=${routerOsString(`${pppoeGateway}/24`)} interface=${routerOsString(bridgeName)} comment=${routerOsString(`${tag} PPPoE gateway`)} } on-error={
            :set serviceError ("${tag}: PPPoE gateway creation failed: " . $error)
            :error $serviceError
        }
    }
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 3/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 3/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 3/7 complete - Hotspot and PPPoE gateways ready." }

# 4. Hotspot DHCP pool, network, server, and profile.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 4/7 - Hotspot DHCP, profile, and server starting."
:do {
    # Migrate the previous router-scoped names before applying the canonical
    # shared service names. Only rename a legacy resource when its canonical
    # name is not already occupied.
    :if ([:len [/ip pool find where name=${routerOsString(hotspotPool)}]] = 0) do={
        :if ([:len [/ip pool find where name=${routerOsString(legacyHotspot.poolName)}]] > 0) do={
            /ip pool set [find where name=${routerOsString(legacyHotspot.poolName)}] name=${routerOsString(hotspotPool)}
        }
    }
    :if ([:len [/ip hotspot profile find where name=${routerOsString(hotspotProfile)}]] = 0) do={
        :if ([:len [/ip hotspot profile find where name="hprofile"]] > 0) do={
            /ip hotspot profile set [find where name="hprofile"] name=${routerOsString(hotspotProfile)}
        }
    }
    :if ([:len [/ip hotspot find where name=${routerOsString(hotspotServer)}]] = 0) do={
        :if ([:len [/ip hotspot find where name=${routerOsString(legacyHotspot.serverName)}]] > 0) do={
            /ip hotspot set [find where name=${routerOsString(legacyHotspot.serverName)}] name=${routerOsString(hotspotServer)}
        }
    }
    :if ([:len [/ip pool find where name=${routerOsString(hotspotPool)}]] = 0) do={
        /ip pool add name=${routerOsString(hotspotPool)} ranges=192.168.180.10-192.168.183.254 comment=${routerOsString(`${tag} Hotspot pool`)}
    }
    :if ([:len [/ip pool find where name=${routerOsString(hotspotPool)}]] > 0) do={
        /ip pool set [find where name=${routerOsString(hotspotPool)}] ranges=192.168.180.10-192.168.183.254 comment=${routerOsString(`${tag} Hotspot pool`)}
    }
    :if ([:len [/ip dhcp-server network find where address=${routerOsString(hotspotNetwork)}]] = 0) do={
        /ip dhcp-server network add address=${routerOsString(hotspotNetwork)} gateway=${routerOsString(hotspotGateway)} dns-server=${routerOsString(`${hotspotGateway},8.8.8.8`)} comment=${routerOsString(`${tag} Hotspot DHCP network`)}
    } else={
        /ip dhcp-server network set [find where address=${routerOsString(hotspotNetwork)}] gateway=${routerOsString(hotspotGateway)} dns-server=${routerOsString(`${hotspotGateway},8.8.8.8`)} comment=${routerOsString(`${tag} Hotspot DHCP network`)}
    }
    :if ([:len [/ip dhcp-server find where name=${routerOsString(dhcpServer)}]] = 0) do={
        /ip dhcp-server add name=${routerOsString(dhcpServer)} interface=${routerOsString(bridgeName)} address-pool=${routerOsString(hotspotPool)} disabled=no
    } else={
        /ip dhcp-server set [find where name=${routerOsString(dhcpServer)}] interface=${routerOsString(bridgeName)} address-pool=${routerOsString(hotspotPool)} disabled=no
    }
    :if ([:len [/ip hotspot profile find where name=${routerOsString(hotspotProfile)}]] = 0) do={
        /ip hotspot profile add name=${routerOsString(hotspotProfile)} hotspot-address=${routerOsString(hotspotGateway)} html-directory=hotspot login-by=http-chap,http-pap,cookie
    } else={
        /ip hotspot profile set [find where name=${routerOsString(hotspotProfile)}] hotspot-address=${routerOsString(hotspotGateway)} html-directory=hotspot login-by=http-chap,http-pap,cookie
    }
    :if ([:len [/ip hotspot find where name=${routerOsString(hotspotServer)}]] = 0) do={
        /ip hotspot add name=${routerOsString(hotspotServer)} interface=${routerOsString(bridgeName)} profile=${routerOsString(hotspotProfile)} address-pool=${routerOsString(hotspotPool)} disabled=no
    } else={
        /ip hotspot set [find where name=${routerOsString(hotspotServer)}] interface=${routerOsString(bridgeName)} profile=${routerOsString(hotspotProfile)} address-pool=${routerOsString(hotspotPool)} disabled=no
    }
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 4/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 4/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 4/7 complete - Hotspot service ready." }

# 5. Only this installation's walled-garden entries are replaced.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 5/7 - walled garden starting."
:do {
    /ip hotspot walled-garden ip
    :do { remove [find where comment~${routerOsString(`${tag} walled garden `)}] } on-error={}
    :do { remove [find where comment~${routerOsString(`${tag} payment walled garden `)}] } on-error={}
    ${walledGardenSetup}
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 5/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 5/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 5/7 complete - walled garden ready." }

# 6. PPPoE pool, profile, and server on the same service bridge.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 6/7 - PPPoE starting."
:do {
    :if ([:len [/ip pool find where name=${routerOsString(pppoePool)}]] = 0) do={
        /ip pool add name=${routerOsString(pppoePool)} ranges=192.168.99.10-192.168.99.254 comment=${routerOsString(`${tag} PPPoE pool`)}
    }
    :if ([:len [/ip pool find where name=${routerOsString(pppoePool)}]] > 0) do={
        /ip pool set [find where name=${routerOsString(pppoePool)}] ranges=192.168.99.10-192.168.99.254 comment=${routerOsString(`${tag} PPPoE pool`)}
    }
    :if ([:len [/ppp profile find where name=${routerOsString(pppoeProfile)}]] = 0) do={
        /ppp profile add name=${routerOsString(pppoeProfile)} local-address=${routerOsString(pppoeGateway)} remote-address=${routerOsString(pppoePool)} dns-server=${routerOsString(`${hotspotGateway},8.8.8.8`)} only-one=yes use-encryption=yes change-tcp-mss=yes comment=${routerOsString(`${tag} PPPoE profile`)}
    } else={
        /ppp profile set [find where name=${routerOsString(pppoeProfile)}] local-address=${routerOsString(pppoeGateway)} remote-address=${routerOsString(pppoePool)} dns-server=${routerOsString(`${hotspotGateway},8.8.8.8`)} only-one=yes use-encryption=yes change-tcp-mss=yes comment=${routerOsString(`${tag} PPPoE profile`)}
    }
    :if ([:len [/interface pppoe-server server find where service-name=${routerOsString(`${tag}-pppoe`)}]] = 0) do={
        /interface pppoe-server server add service-name=${routerOsString(`${tag}-pppoe`)} interface=${routerOsString(bridgeName)} default-profile=${routerOsString(pppoeProfile)} one-session-per-host=yes disabled=no
    } else={
        /interface pppoe-server server set [find where service-name=${routerOsString(`${tag}-pppoe`)}] interface=${routerOsString(bridgeName)} default-profile=${routerOsString(pppoeProfile)} one-session-per-host=yes disabled=no
    }
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 6/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 6/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 6/7 complete - PPPoE service ready." }

# 7. Customer NAT for both service networks, only when the standard WAN list exists.
:set serviceStepFailed false
:put "${tag}: SERVICE STEP 7/7 - customer NAT starting."
:do {
:local serviceWanLists [/interface list find where name="WAN"]
:do { /ip dns set allow-remote-requests=yes } on-error={
    :set serviceStepFailed true
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: router DNS could not be enabled: " . $error . " | ")
    :put ("${tag}: router DNS could not be enabled: " . $error)
}
:do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} service-to-wan`)}] } on-error={}
:do { /ip firewall filter add chain=forward action=accept in-interface=${routerOsString(bridgeName)} out-interface-list=WAN hotspot=auth connection-state=new,established,related comment=${routerOsString(`${tag} service-to-wan`)} place-before=0 } on-error={
    :set serviceStepFailed true
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: authenticated Hotspot forwarding could not be added: " . $error . " | ")
    :put ("${tag}: authenticated Hotspot forwarding could not be added: " . $error)
}
:do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} pppoe-to-wan`)}] } on-error={}
:do { /ip firewall filter add chain=forward action=accept src-address=${routerOsString(pppoeNetwork)} out-interface-list=WAN connection-state=new,established,related comment=${routerOsString(`${tag} pppoe-to-wan`)} place-before=0 } on-error={
    :set serviceStepFailed true
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: PPPoE forwarding could not be added: " . $error . " | ")
    :put ("${tag}: PPPoE forwarding could not be added: " . $error)
}
:do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} allow-service-dns-udp`)}] } on-error={}
:do { /ip firewall filter add chain=input action=accept in-interface=${routerOsString(bridgeName)} protocol=udp dst-port=53 comment=${routerOsString(`${tag} allow-service-dns-udp`)} place-before=0 } on-error={
    :set serviceStepFailed true
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: UDP DNS access could not be added: " . $error . " | ")
    :put ("${tag}: UDP DNS access could not be added: " . $error)
}
:do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} allow-service-dns-tcp`)}] } on-error={}
:do { /ip firewall filter add chain=input action=accept in-interface=${routerOsString(bridgeName)} protocol=tcp dst-port=53 comment=${routerOsString(`${tag} allow-service-dns-tcp`)} place-before=0 } on-error={
    :set serviceStepFailed true
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: TCP DNS access could not be added: " . $error . " | ")
    :put ("${tag}: TCP DNS access could not be added: " . $error)
}
:if ([:len $serviceWanLists] > 0) do={
    :do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} block-wan-dns-udp`)}] } on-error={}
    :do { /ip firewall filter add chain=input action=drop in-interface-list=WAN protocol=udp dst-port=53 comment=${routerOsString(`${tag} block-wan-dns-udp`)} place-before=0 } on-error={
        :set serviceStepFailed true
        :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: WAN UDP DNS protection could not be added: " . $error . " | ")
        :put ("${tag}: WAN UDP DNS protection could not be added: " . $error)
    }
    :do { /ip firewall filter remove [find where comment=${routerOsString(`${tag} block-wan-dns-tcp`)}] } on-error={}
    :do { /ip firewall filter add chain=input action=drop in-interface-list=WAN protocol=tcp dst-port=53 comment=${routerOsString(`${tag} block-wan-dns-tcp`)} place-before=0 } on-error={
        :set serviceStepFailed true
        :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: WAN TCP DNS protection could not be added: " . $error . " | ")
        :put ("${tag}: WAN TCP DNS protection could not be added: " . $error)
    }
}
:if ([:len $serviceWanLists] > 0) do={
    :do { /ip firewall nat remove [find where comment=${routerOsString(`${tag} Hotspot masquerade`)}] } on-error={}
    :do { /ip firewall nat add chain=srcnat action=masquerade src-address=${routerOsString(hotspotNetwork)} out-interface-list=WAN comment=${routerOsString(`${tag} Hotspot masquerade`)} } on-error={
        :set serviceStepFailed true
        :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: Hotspot NAT could not be added: " . $error . " | ")
        :put ("${tag}: Hotspot NAT could not be added: " . $error)
    }
    :do { /ip firewall nat remove [find where comment=${routerOsString(`${tag} PPPoE masquerade`)}] } on-error={}
    :do { /ip firewall nat add chain=srcnat action=masquerade src-address=${routerOsString(pppoeNetwork)} out-interface-list=WAN comment=${routerOsString(`${tag} PPPoE masquerade`)} } on-error={
        :set serviceStepFailed true
        :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: PPPoE NAT could not be added: " . $error . " | ")
        :put ("${tag}: PPPoE NAT could not be added: " . $error)
    }
} else={
    :put "${tag}: WAN interface list is absent; customer NAT was not changed."
}
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SERVICE STEP 7/7: " . $serviceStepError . " | ")
    :put ("${tag}: SERVICE STEP 7/7 FAILED: " . $serviceStepError)
}
:if (!$serviceStepFailed) do={ :put "${tag}: SERVICE STEP 7/7 complete - customer NAT ready or safely preserved." }

:put "${tag}: SCRIPT 4 optional bandwidth tree starting."
:do {
    ${queueSetup}
} on-error={
    :set serviceStepFailed true
    :local serviceStepError $error
    :if ([:len $serviceStepError] = 0) do={ :set serviceStepError "RouterOS returned no diagnostic text" }
    :set serviceFailures ($serviceFailures . "SCRIPT 4 bandwidth tree: " . $serviceStepError . " | ")
    :put ("${tag}: SCRIPT 4 bandwidth tree failed: " . $serviceStepError)
}

:if ([:len $serviceFailures] > 0) do={
    :put "${tag}: servicessetup.rsc finished with failed service steps:"
    :put $serviceFailures
    :put "${tag}: Fix the listed failures and rerun servicessetup.rsc; completed resources are reconciled safely."
} else={
    :put "${tag}: servicessetup.rsc complete - all seven service steps succeeded."
}
`;
}
function generateFirewallScript(vpsIp, options) {
  const { enableApiSsl = true, comment = "VPS-ONLY" } = options ?? {};
  const ports = enableApiSsl ? "8728,8729" : "8728";
  return `# OcholaSupernet \u2014 MikroTik API Firewall Rules
# Generated: ${(/* @__PURE__ */ new Date()).toISOString()}
# Purpose: Allow API access ONLY from VPS IP ${vpsIp}
# Paste into terminal or upload and run: /import filename.rsc

# \u2500\u2500 1. Allow API from VPS (must come FIRST) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/ip firewall filter
add action=accept chain=input comment="${comment}-allow-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp \\
    src-address=${vpsIp}

# \u2500\u2500 2. Drop API access from all other sources \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
add action=drop chain=input comment="${comment}-block-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp

# \u2500\u2500 3. (Optional) Enable API-SSL service on port 8729 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${enableApiSsl ? "/ip service enable api-ssl" : "# /ip service enable api-ssl  (uncomment to enable)"}

# \u2500\u2500 Verify \u2014 check that the rules are in place \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# :log info "Firewall rules applied. API restricted to ${vpsIp} only."
`;
}
async function fetchRouterSecurityState(creds) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const read = (path) => withTimeout(
      conn.write([path]),
      ms
    );
    const [
      firewallFilter,
      firewallNat,
      firewallMangle,
      firewallRaw,
      addresses,
      routes,
      bridgePorts
    ] = await Promise.all([
      read("/ip/firewall/filter/print"),
      read("/ip/firewall/nat/print"),
      read("/ip/firewall/mangle/print"),
      read("/ip/firewall/raw/print"),
      read("/ip/address/print"),
      read("/ip/route/print"),
      read("/interface/bridge/port/print")
    ]);
    return {
      firewallFilter,
      firewallNat,
      firewallMangle,
      firewallRaw,
      addresses,
      routes,
      bridgePorts,
      connectedVia: connectedHost
    };
  });
}
async function fetchBridgePortLayout(creds) {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const [ifaceRows, bridgeRows, bpRows] = await Promise.all([
      withTimeout(conn.write(["/interface/print"]), ms),
      withTimeout(conn.write(["/interface/bridge/print"]), ms),
      withTimeout(conn.write(["/interface/bridge/port/print"]), ms)
    ]);
    const interfaces = (Array.isArray(ifaceRows) ? ifaceRows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      type: r.type ?? "",
      running: parseBool(r.running),
      disabled: parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment: r.comment ?? "",
      txBps: parseBytes(r["tx-byte"]),
      rxBps: parseBytes(r["rx-byte"])
    }));
    const bridges = (Array.isArray(bridgeRows) ? bridgeRows : []).map((r) => ({
      name: r.name ?? "",
      running: parseBool(r.running)
    }));
    const bridgePorts = (Array.isArray(bpRows) ? bpRows : []).map((r) => ({
      id: r[".id"] ?? "",
      bridge: r.bridge ?? "",
      interface: r.interface ?? ""
    }));
    return { interfaces, bridges, bridgePorts, connectedVia: connectedHost };
  });
}
async function assignBridgePorts(creds, bridgeName, addPorts, removePorts) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const logs = [];
    const existing = await withTimeout(
      conn.write(["/interface/bridge/port/print"]),
      ms
    );
    const globalPortMap = {};
    (Array.isArray(existing) ? existing : []).forEach((r) => {
      if (r.interface && r[".id"]) {
        globalPortMap[r.interface] = { id: r[".id"], bridge: r.bridge ?? "" };
      }
    });
    for (const iface of removePorts) {
      const entry = globalPortMap[iface];
      if (!entry || entry.bridge !== bridgeName) {
        logs.push(`\u26A0 ${iface}: not in ${bridgeName}, skipping remove`);
        continue;
      }
      try {
        await withTimeout(conn.write(["/interface/bridge/port/remove", `=.id=${entry.id}`]), ms);
        logs.push(`\u2713 Removed ${iface} from ${bridgeName}`);
        delete globalPortMap[iface];
      } catch (e) {
        logs.push(`\u2717 Failed to remove ${iface}: ${e.message}`);
      }
    }
    for (const iface of addPorts) {
      const entry = globalPortMap[iface];
      if (entry && entry.bridge === bridgeName) {
        logs.push(`\u26A0 ${iface}: already in ${bridgeName}, skipping`);
        continue;
      }
      if (entry && entry.bridge && entry.bridge !== bridgeName) {
        try {
          await withTimeout(conn.write(["/interface/bridge/port/remove", `=.id=${entry.id}`]), ms);
          logs.push(`  \u21A9 Moved ${iface} out of ${entry.bridge}`);
        } catch (e) {
          logs.push(`\u2717 Could not remove ${iface} from ${entry.bridge}: ${e.message}`);
          continue;
        }
      }
      try {
        await withTimeout(
          conn.write(["/interface/bridge/port/add", `=bridge=${bridgeName}`, `=interface=${iface}`]),
          ms
        );
        logs.push(`\u2713 Added ${iface} \u2192 ${bridgeName}`);
      } catch (e) {
        logs.push(`\u2717 Failed to add ${iface}: ${e.message}`);
      }
    }
    if (logs.length === 0) logs.push("No changes made.");
    return logs;
  });
}
async function createBridge(creds, bridgeName) {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const existing = await withTimeout(
      conn.write(["/interface/bridge/print", `?name=${bridgeName}`]),
      ms
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return { created: false, message: `Bridge "${bridgeName}" already exists.` };
    }
    await withTimeout(
      conn.write(["/interface/bridge/add", `=name=${bridgeName}`]),
      ms
    );
    return { created: true, message: `Bridge "${bridgeName}" created successfully.` };
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RouterFileExistsError,
  addDstNatRule,
  addHotspotIpBinding,
  addHotspotUser,
  addHotspotUserProfile,
  addIpPool,
  addIpToAddressList,
  addPPPProfile,
  addPPPSecret,
  assignBridgePorts,
  changeHotspotUsername,
  changePPPSecretName,
  classifyRouterConnectionFailure,
  connectHotspotUser,
  createBridge,
  deployRouterFile,
  detectBridgeInterfaces,
  disableGeneratedHotspot,
  disconnectHotspotActiveUser,
  disconnectPPPActive,
  disconnectPPPActiveByName,
  ensureHotspotServerAddressPool,
  ensureHotspotUserProfile,
  ensureHotspotUserRateQueue,
  ensureRouterHttpsTrust,
  ensureRouterManagementAccess,
  fetchBridgePortLayout,
  fetchHotspotConnectedDevices,
  fetchHotspotUserList,
  fetchHotspotUsers,
  fetchInterfaces,
  fetchIpPools,
  fetchPPPProfiles,
  fetchPPPSecrets,
  fetchPPPoEActive,
  fetchRouterFiles,
  fetchRouterLiveData,
  fetchRouterSecurityState,
  fetchTraffic,
  fetchWireless,
  generateFirewallScript,
  generateNetworkSetupScript,
  generateOvpnClientConfig,
  generateRouterAsClientScript,
  generateRouterIpsecClientScript,
  generateRouterManagementVpnScript,
  generateRouterWireGuardClientScript,
  generateServiceSetupScript,
  generateVpnSetupScript,
  getEnvCredentials,
  getHotspotUserIp,
  isHotspotUserOnline,
  isPPPUserOnline,
  isPrivateIp,
  pingRouter,
  probeAllHosts,
  probePort,
  reconcileGeneratedServiceConfiguration,
  reconcileHotspotUserAccess,
  reconcilePppoeUserAccess,
  removeDstNatByAddress,
  removeHotspotIpBinding,
  removeHotspotUser,
  removeHotspotUserExpiry,
  removeHotspotUserProfile,
  removeHotspotUserRateQueue,
  removeIpFromAddressList,
  removeIpPool,
  removePPPProfile,
  removePPPSecret,
  removePPPSecretByName,
  removePppUserExpiry,
  repairGeneratedServiceNetworking,
  requireHotspotUserProfile,
  resetHotspotUserCounters,
  resolveHotspotClientMac,
  runRouterCommand,
  scheduleHotspotUserExpiry,
  schedulePppUserExpiry,
  setWirelessInterface,
  setWirelessSecurityProfile,
  syncHotspotPortalHostname,
  testConnection,
  updateHotspotUser,
  updateHotspotUserProfile,
  updateIpPool,
  updatePPPProfile,
  updatePPPSecret
});
