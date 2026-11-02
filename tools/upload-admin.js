"use strict";

/*
 * Writes the admin files directly into the file storage of the dev-server ioBroker.
 *
 * "dev-server upload" cannot be used while "dev-server watch" runs (on Windows the adapter directory is locked),
 * and "dev-server watch" does not synchronize the admin directory of this adapter.
 * "iobroker upload" would also update the instance object, which makes ioBroker start a second adapter process.
 * So only the files are written, objects are not touched. After changes of io-package.json use "dev-server upload".
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const profileDir = path.join(root, ".dev-server", "default");
const adminDir = path.join(root, "admin");
const controllerDir = path.join(profileDir, "node_modules", "iobroker.js-controller");

/** directories which are not needed in ioBroker, the React sources are bundled into admin/build */
const EXCLUDED = new Set(["src", ".watch"]);

/**
 * @param {string} dir
 * @returns {string[]} paths relative to the admin directory, with "/" as separator
 */
function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return EXCLUDED.has(entry.name) && dir === adminDir ? [] : listFiles(full);
        }
        return [path.relative(adminDir, full).split(path.sep).join("/")];
    });
}

async function main() {
    if (!fs.existsSync(controllerDir)) {
        throw new Error(`${controllerDir} not found, run "npm run dev-server setup" first`);
    }
    const config = JSON.parse(fs.readFileSync(path.join(profileDir, "iobroker-data", "iobroker.json"), "utf8"));
    const { Client } = require(require.resolve("@iobroker/db-objects-redis", { paths: [controllerDir] }));

    const logger = {
        silly: () => {},
        debug: () => {},
        info: () => {},
        warn: (/** @type {string} */ msg) => console.warn(msg),
        error: (/** @type {string} */ msg) => console.error(msg),
    };
    const objects = await new Promise((resolve, reject) => {
        const fail = () =>
            reject(
                new Error('Cannot connect to the ioBroker of the dev-server, is "npm run dev-server watch" running?'),
            );
        // the client neither calls "connected" nor "disconnected" if the database is not running at all
        const timeout = setTimeout(() => {
            fail();
            client.destroy().catch(() => {});
        }, 5000);
        const client = new Client({
            connection: config.objects,
            logger,
            connected: () => {
                clearTimeout(timeout);
                resolve(client);
            },
            disconnected: () => {
                clearTimeout(timeout);
                fail();
            },
        });
    });

    try {
        const files = listFiles(adminDir);
        const adapterName = JSON.parse(fs.readFileSync(path.join(root, "io-package.json"), "utf8")).common.name;
        for (const file of files) {
            await objects.writeFileAsync(`${adapterName}.admin`, file, fs.readFileSync(path.join(adminDir, file)));
        }
        console.log(`Uploaded ${files.length} admin files`);
    } finally {
        await objects.destroy();
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
