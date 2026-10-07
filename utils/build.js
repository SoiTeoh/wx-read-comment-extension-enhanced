// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.ASSET_PATH = '/';

var webpack = require('webpack'),
    path = require('path'),
    fs = require('fs'),
    config = require('../webpack.config'),
    ZipPlugin = require('zip-webpack-plugin');

delete config.chromeExtensionBoilerplate;

config.mode = 'production';

config.plugins = (config.plugins || []).concat(
    new ZipPlugin({
        filename: `wx-read-comment-extension-enhanced-v${require('../package.json').version}.zip`,
        path: path.join(__dirname, '../'),
    })
);

// 和命令行运行 env NODE_ENV=production webpack 一样的效果
// 有时候执行失败 有没有报错 执行 NODE_ENV=production webpack --progress 看下具体过程
webpack(config, function (err, stats) {
    if (err) {
        console.error('build error', err);
        process.exitCode = 1;
    } else if (stats.hasErrors()) {
        console.error(stats.toString({ all: false, errors: true }));
        process.exitCode = 1;
    } else {
        console.log('Build and release ZIP completed successfully.');
    }
});
