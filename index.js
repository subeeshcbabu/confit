'use strict';

var path = require('path');
var shush = require('shush');
var caller = require('caller');
var thing = require('core-util-is');
var shortstop = require('shortstop');
var common = require('./lib/common');
var provider = require('./lib/provider');
var debug = require('debuglog')('confit');


function config(store) {
    return {

        get: function get(key) {
            var obj;

            if (thing.isString(key) && key.length) {

                key = key.split(':');
                obj = store;

                while (obj && key.length) {
                    if (obj.constructor !== Object) {
                        // Do not allow traversal into complex types,
                        // such as Buffer, Date, etc. So, this type
                        // of key will fail: 'foo:mystring:length'
                        return undefined;
                    }
                    obj = obj[key.shift()];
                }

                return obj;

            }

            return undefined;
        },

        set: function set(key, value) {
            var obj, prop;

            if (thing.isString(key) && key.length) {

                key = key.split(':');
                obj = store;

                while (key.length - 1) {
                    prop = key.shift();

                    // Create new object for property, if nonexistent
                    if (!obj.hasOwnProperty(prop)) {
                        obj[prop] = {};
                    }

                    obj = obj[prop];
                    if (obj && obj.constructor !== Object) {
                        return undefined;
                    }
                }

                return (obj[key.shift()] = value);
            }

            return undefined;
        },

        use: function use(obj) {
            common.marge(obj, store);
        }

    };
}


function builder(options) {
    return {

        _store: {},

        addOverride: function addOverride(file) {
            file = common.isAbsolute(file) ? file : path.join(options.basedir, file);
            common.marge(shush(file), this._store);
            return this;
        },

        create: function create(callback) {
            var shorty;

            shorty = shortstop.create();
            Object.keys(options.protocols).forEach(function (protocol) {
                shorty.use(protocol, options.protocols[protocol]);
            }, this);

            shorty.resolve(this._store, function (err, data) {
                if (err) {
                    callback(err);
                    return;
                }
                callback(null, config(data));
            });
        }

    };
}


function possibly(resolve, reject) {
    return function maybe() {
        try {
            return resolve.apply(null, arguments);
        } catch (err) {
            reject(err);
        }
    };
}


function resolve(file, store) {
    return common.marge(shush(file), store);
}


function reject(err) {
    if (err.code && err.code === 'MODULE_NOT_FOUND') {
        debug('WARNING:', err.message);
        return;
    }
    throw err;
}


module.exports = function confit(options) {
    var factory, margeFile, file;

    // Normalize arguments
    if (thing.isString(options)) {
        options = { basedir: options };
    }

    // ¯\_(ツ)_/¯ ... still normalizing
    options = options || {};
    options.defaults = options.defaults || 'config.json';
    options.basedir = options.basedir || path.dirname(caller());
    options.protocols = options.protocols || {};

    factory = builder(options);
    common.marge(provider.argv(), factory._store);
    common.marge(provider.env(), factory._store);
    common.marge(provider.convenience(), factory._store);

    // Backdoor a couple files before we get going.
    margeFile = possibly(resolve, reject);

    // File 1: The default config file.
    file = path.join(options.basedir, options.defaults);
    margeFile(file, factory._store);

    // File 2: The env-specific config file.
    file = path.join(options.basedir, factory._store.env.env + '.json');
    margeFile(file, factory._store);

    return factory;
};
