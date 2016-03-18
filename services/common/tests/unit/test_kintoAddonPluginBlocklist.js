/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

const { Constructor: CC } = Components;

const KEY_PROFILEDIR = "ProfD";
const FILE_BLOCKLIST_ADDONS  = "blocklist-addons.json";
const FILE_BLOCKLIST_GFX     = "blocklist-gfx.json";
const FILE_BLOCKLIST_PLUGINS = "blocklist-plugins.json";
const PREF_KINTO_ADDONS_CHECKED_SECONDS  = "services.kinto.addons.checked";
const PREF_KINTO_GFX_CHECKED_SECONDS     = "services.kinto.gfx.checked";
const PREF_KINTO_PLUGINS_CHECKED_SECONDS = "services.kinto.plugins.checked";


Cu.import("resource://services-common/KintoBlocklist.js");
Cu.import("resource://services-common/moz-kinto-client.js");
Cu.import("resource://testing-common/httpd.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const BinaryInputStream = CC("@mozilla.org/binaryinputstream;1",
  "nsIBinaryInputStream", "setInputStream");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm");

var server;
var kintoClient;

function kintoCollection(collectionName) {
  if (!kintoClient) {
    const Kinto = loadKinto();
    const FirefoxAdapter = Kinto.adapters.FirefoxAdapter;
    const config = {
      // Set the remote to be some server that will cause test failure when
      // hit since we should never hit the server directly, only via maybeSync()
      remote: "https://firefox.settings.services.mozilla.com/v1/",
      adapter: FirefoxAdapter,
      bucket: "blocklists"
    };
    kintoClient = new Kinto(config);
  }
  return kintoClient.collection(collectionName);
}


function* readJSON(filepath) {
  const binaryData = yield OS.File.read(filepath);
  const textData = (new TextDecoder()).decode(binaryData);
  return Promise.resolve(JSON.parse(textData));
}


function* clear_state() {
  // Remove last server times.
  Services.prefs.clearUserPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  Services.prefs.clearUserPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);

  // Remove profile data.
  let blocklist = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_ADDONS]);
  if (blocklist.exists())
    blocklist.remove(true);
  blocklist = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_PLUGINS]);
  if (blocklist.exists())
    blocklist.remove(true);

  // Clear local DBs.
  for(let name of ["addons", "plugins"]) {
    const collection = kintoCollection(name);
    try {
      yield collection.db.open();
      yield collection.clear();
    } finally {
      yield collection.db.close();
    }
  }
}


function run_test() {
  // Set up an HTTP Server
  server = new HttpServer();
  server.start(-1);

  // Point the KintoAddonPlugin client to use this local HTTP server.
  Services.prefs.setCharPref("services.kinto.base",
                             `http://localhost:${server.identity.primaryPort}/v1`);

  // Setup server fake responses.
  function handleResponse (request, response) {
    try {
      const sampled = getSampleResponse(request, server.identity.primaryPort);
      if (!sampled) {
        do_throw(`unexpected ${request.method} request for ${request.path}?${request.queryString}`);
      }

      response.setStatusLine(null, sampled.status.status,
                             sampled.status.statusText);
      // send the headers
      for (let headerLine of sampled.sampleHeaders) {
        let headerElements = headerLine.split(':');
        response.setHeader(headerElements[0], headerElements[1].trimLeft());
      }
      response.setHeader("Date", (new Date()).toUTCString());

      response.write(sampled.responseBody);
    } catch (e) {
      dump(`${e}\n`);
    }
  }
  const configPath = "/v1/";
  const addonsRecordsPath  = "/v1/buckets/blocklists/collections/addons/records";
  const gfxRecordsPath     = "/v1/buckets/blocklists/collections/gfx/records";
  const pluginsRecordsPath = "/v1/buckets/blocklists/collections/plugins/records";
  server.registerPathHandler(configPath, handleResponse);
  server.registerPathHandler(addonsRecordsPath, handleResponse);
  server.registerPathHandler(gfxRecordsPath, handleResponse);
  server.registerPathHandler(pluginsRecordsPath, handleResponse);


  run_next_test();

  do_register_cleanup(function() {
    server.stop(function() { });
  });
}

add_task(function* test_addons_records_obtained_from_server_are_stored_in_db(){
  // Test an empty db populates
  let result = yield AddonClient.maybeSync(2000, Date.now());

  // Open the collection, verify it's been populated:
  // Our test data has a single record; it should be in the local collection
  let collection = kintoCollection("addons");
  yield collection.db.open();
  let list = yield collection.list();
  equal(list.data.length, 1);
  yield collection.db.close();
});

add_task(clear_state);


add_task(function* test_plugins_records_obtained_from_server_are_stored_in_db(){
  let result = yield PluginClient.maybeSync(2000, Date.now());

  let collection = kintoCollection("plugins");
  yield collection.db.open();
  let list = yield collection.list();
  // Default records response has 1 record:
  equal(list.data.length, 1);
  yield collection.db.close();
});

add_task(clear_state);


add_task(function* test_addons_list_is_written_to_file_in_profile(){
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_ADDONS]);
  strictEqual(profFile.exists(), false);

  let result = yield AddonClient.maybeSync(2000, Date.now());

  strictEqual(profFile.exists(), true);
  const content = yield readJSON(profFile.path);
  equal(content.data[0].blockID, "i539");
});

add_task(clear_state);


add_task(function* test_plugins_list_is_written_to_file_in_profile(){
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_PLUGINS]);
  strictEqual(profFile.exists(), false);

  let result = yield PluginClient.maybeSync(2000, Date.now());

  strictEqual(profFile.exists(), true);
  const content = yield readJSON(profFile.path);
  equal(content.data[0].blockID, "p28");
});

add_task(clear_state);


add_task(function* test_current_server_time_is_saved_in_addons_pref(){
  const before = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  yield AddonClient.maybeSync(2000, Date.now());
  const after = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_current_server_time_is_saved_in_plugins_pref(){
  const before = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  yield PluginClient.maybeSync(2000, Date.now());
  const after = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_current_server_time_is_saved_in_gfx_pref(){
  const before = Services.prefs.getIntPref(PREF_KINTO_GFX_CHECKED_SECONDS);
  yield GfxClient.maybeSync(2000, Date.now());
  const after = Services.prefs.getIntPref(PREF_KINTO_GFX_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_update_json_file_when_addons_has_changes(){
  yield AddonClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_ADDONS]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield AddonClient.maybeSync(3001, Date.now());

  // File was updated.
  notEqual(fileLastModified, profFile.lastModifiedTime);
  const content = yield readJSON(profFile.path);
  deepEqual(content.data.map((r) => r.blockID).sort(), ["i539","i720","i808"]);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_update_json_file_when_plugins_has_changes(){
  yield PluginClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_PLUGINS]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield PluginClient.maybeSync(3001, Date.now());

  // File was updated.
  notEqual(fileLastModified, profFile.lastModifiedTime);
  const content = yield readJSON(profFile.path);
  deepEqual(content.data.map((r) => r.blockID).sort(), ["p1044","p28","p32"]);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_update_json_file_when_gfx_has_changes(){
  yield GfxClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_GFX_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_GFX]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield GfxClient.maybeSync(3001, Date.now());

  // File was updated.
  notEqual(fileLastModified, profFile.lastModifiedTime);
  const content = yield readJSON(profFile.path);
  deepEqual(content.data.map((r) => r.blockID).sort(), ["g200","g204","g36"]);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_GFX_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_sends_reload_message_when_addons_has_changes(){
  let received = null;
  Services.ppmm.addMessageListener("Blocklist:reload-from-disk", {
    receiveMessage: (aMsg) => {received = aMsg}
  });

  yield AddonClient.maybeSync(2000, Date.now() - 1000);
  // XXXX: Get rid of this second call: wait for message to be received instead!
  yield AddonClient.maybeSync(3001, Date.now() - 1000);

  equal(received.data.filename, "blocklist-addons.json");
});

add_task(clear_state);


add_task(function* test_sends_reload_message_when_plugins_has_changes(){
  let received = null;
  Services.ppmm.addMessageListener("Blocklist:reload-from-disk", {
    receiveMessage: (aMsg) => {received = aMsg}
  });

  yield PluginClient.maybeSync(2000, Date.now() - 1000);
  // XXXX: Get rid of this second call: wait for message to be received instead!
  yield PluginClient.maybeSync(3001, Date.now() - 1000);

  equal(received.data.filename, "blocklist-plugins.json");
});

add_task(clear_state);


add_task(function* test_sends_reload_message_when_gfx_has_changes(){
  let received = null;
  Services.ppmm.addMessageListener("Blocklist:reload-from-disk", {
    receiveMessage: (aMsg) => {received = aMsg}
  });

  yield GfxClient.maybeSync(2000, Date.now() - 1000);
  // XXXX: Get rid of this second call: wait for message to be received instead!
  yield GfxClient.maybeSync(3001, Date.now() - 1000);

  equal(received.data.filename, "blocklist-gfx.json");
});

add_task(clear_state);


add_task(function* test_do_nothing_when_addons_is_up_to_date(){
  yield AddonClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_ADDONS]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield AddonClient.maybeSync(3000, Date.now());

  // File was not updated.
  equal(fileLastModified, profFile.lastModifiedTime);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_ADDONS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_do_nothing_when_plugins_is_up_to_date(){
  yield PluginClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_PLUGINS]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield PluginClient.maybeSync(3000, Date.now());

  // File was not updated.
  equal(fileLastModified, profFile.lastModifiedTime);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


add_task(function* test_do_nothing_when_gfx_is_up_to_date(){
  yield PluginClient.maybeSync(2000, Date.now() - 1000);
  const before = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  var profFile = FileUtils.getFile(KEY_PROFILEDIR, [FILE_BLOCKLIST_PLUGINS]);
  const fileLastModified = profFile.lastModifiedTime = profFile.lastModifiedTime - 1000;

  yield PluginClient.maybeSync(3000, Date.now());

  // File was not updated.
  equal(fileLastModified, profFile.lastModifiedTime);
  // Server time was updated.
  const after = Services.prefs.getIntPref(PREF_KINTO_PLUGINS_CHECKED_SECONDS);
  notEqual(before, after);
});

add_task(clear_state);


// get a response for a given request from sample data
function getSampleResponse(req, port) {
  const responses = {
    "OPTIONS": {
      "sampleHeaders": [
        "Access-Control-Allow-Headers: Content-Length,Expires,Backoff,Retry-After,Last-Modified,Total-Records,ETag,Pragma,Cache-Control,authorization,content-type,if-none-match,Alert,Next-Page",
        "Access-Control-Allow-Methods: GET,HEAD,OPTIONS,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Origin: *",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress"
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": "null"
    },
    "GET:/v1/?": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress"
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"settings":{"cliquet.batch_max_requests":25}, "url":`http://localhost:${port}/v1/`, "documentation":"https://kinto.readthedocs.org/", "version":"1.5.1", "commit":"cbc6f58", "hello":"kinto"})
    },
    "GET:/v1/buckets/blocklists/collections/addons/records?": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"3000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "prefs": [],
        "blockID": "i539",
        "last_modified": 3000,
        "versionRange": [{
          "targetApplication": [],
          "maxVersion": "*",
          "minVersion": "0",
          "severity": "1"
        }],
        "guid": "ScorpionSaver@jetpack",
        "id": "9d500963-d80e-3a91-6e74-66f3811b99cc"
      }]})
    },
    "GET:/v1/buckets/blocklists/collections/plugins/records?": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"3000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "matchFilename": "NPFFAddOn.dll",
        "blockID": "p28",
        "id": "7b1e0b3c-e390-a817-11b6-a6887f65f56e",
        "last_modified": 3000,
        "versionRange": []
      }]})
    },
    "GET:/v1/buckets/blocklists/collections/gfx/records?": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"3000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "driverVersionComparator": "LESS_THAN_OR_EQUAL",
        "driverVersion": "8.17.12.5896",
        "vendor": "0x10de",
        "blockID": "g36",
        "feature": "DIRECT3D_9_LAYERS",
        "devices": ["0x0a6c"],
        "featureStatus": "BLOCKED_DRIVER_VERSION",
        "last_modified": 3000,
        "os": "WINNT 6.1",
        "id": "3f947f16-37c2-4e96-d356-78b26363729b"
      }]})
    },
    "GET:/v1/buckets/blocklists/collections/addons/records?_since=3000": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"4000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "prefs": [],
        "blockID": "i808",
        "last_modified": 4000,
        "versionRange": [{
          "targetApplication": [],
          "maxVersion": "*",
          "minVersion": "0",
          "severity": "3"
        }],
        "guid": "{c96d1ae6-c4cf-4984-b110-f5f561b33b5a}",
        "id": "9ccfac91-e463-c30c-f0bd-14143794a8dd"
      }, {
        "prefs": ["browser.startup.homepage"],
        "blockID": "i720",
        "last_modified": 3500,
        "versionRange": [{
          "targetApplication": [],
          "maxVersion": "*",
          "minVersion": "0",
          "severity": "1"
        }],
        "guid": "FXqG@xeeR.net",
        "id": "cf9b3129-a97e-dbd7-9525-a8575ac03c25"
      }]})
    },
    "GET:/v1/buckets/blocklists/collections/plugins/records?_since=3000": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"4000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "infoURL": "https://get.adobe.com/flashplayer/",
        "blockID": "p1044",
        "matchFilename": "libflashplayer\\.so",
        "last_modified": 4000,
        "versionRange": [{
          "targetApplication": [],
          "minVersion": "11.2.202.509",
          "maxVersion": "11.2.202.539",
          "severity": "0",
          "vulnerabilityStatus": "1"
        }],
        "os": "Linux",
        "id": "aabad965-e556-ffe7-4191-074f5dee3df3"
      }, {
        "matchFilename": "npViewpoint.dll",
        "blockID": "p32",
        "id": "1f48af42-c508-b8ef-b8d5-609d48e4f6c9",
        "last_modified": 3500,
        "versionRange": [{
          "targetApplication": [{
            "minVersion": "3.0",
            "guid": "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}",
            "maxVersion": "*"
          }]
        }]
      }]})
    },
    "GET:/v1/buckets/blocklists/collections/gfx/records?_since=3000": {
      "sampleHeaders": [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Expose-Headers: Retry-After, Content-Length, Alert, Backoff",
        "Content-Type: application/json; charset=UTF-8",
        "Server: waitress",
        "Etag: \"4000\""
      ],
      "status": {status: 200, statusText: "OK"},
      "responseBody": JSON.stringify({"data":[{
        "vendor": "0x8086",
        "blockID": "g204",
        "feature": "WEBGL_MSAA",
        "devices": [],
        "id": "c96bca82-e6bd-044d-14c4-9c1d67e9283a",
        "last_modified": 4000,
        "os": "Darwin 10",
        "featureStatus": "BLOCKED_DEVICE"
      }, {
        "vendor": "0x10de",
        "blockID": "g200",
        "feature": "WEBGL_MSAA",
        "devices": [],
        "id": "c3a15ba9-e0e2-421f-e399-c995e5b8d14e",
        "last_modified": 3500,
        "os": "Darwin 11",
        "featureStatus": "BLOCKED_DEVICE"
      }]})
    }
  };
  return responses[`${req.method}:${req.path}?${req.queryString}`] ||
         responses[req.method];

}
