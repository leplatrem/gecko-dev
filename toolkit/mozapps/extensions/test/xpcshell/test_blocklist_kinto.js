const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Timer.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm");

const PREF_BLOCKLIST_VIA_AMO = "security.blocklist.via.amo";
const KEY_APPDIR             = "XCurProcD";
const KEY_PROFILEDIR         = "ProfD";
const TEST_APP_ID            = "xpcshell@tests.mozilla.org";

const gAppDir = FileUtils.getFile(KEY_APPDIR, []);
const gProfDir = FileUtils.getFile(KEY_PROFILEDIR, []);
const OLD = do_get_file("data/test_blocklist_kinto/old.json");
const NEW = do_get_file("data/test_blocklist_kinto/new.json");
const OLD_TSTAMP = 1296046918000;
const NEW_TSTAMP = 1396046918000;

const SAMPLE_ADDON_RECORD = {
  "prefs": [],
  "blockID": "i446",
  "last_modified": 1457434834683,
  "versionRange": [{
    "targetApplication": [{
      "minVersion": "0.1",
      "guid": "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}",
      "maxVersion": "17.*"
    }],
    "maxVersion": "*",
    "minVersion": "0",
    "severity": "1",
    "vulnerabilityStatus": "0"
  }],
  "guid": "{E90FA778-C2B7-41D0-9FA9-3FEC1CA54D66}",
  "id": "87a5dc56-1fec-ebf2-a09b-6f2cbd4eb2d3"
};

const SAMPLE_PLUGIN_RECORD = {
  "matchFilename": "JavaPlugin2_NPAPI\\.plugin",
  "blockID": "p123",
  "id": "bdcf0717-a873-adbf-7603-83a49fb996bc",
  "last_modified": 1457434851748,
  "versionRange": [{
    "targetApplication": [{
      "minVersion": "0.1",
      "guid": "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}",
      "maxVersion": "17.*"
    }],
    "maxVersion": "14.2.0",
    "minVersion": "0",
    "severity": "1"
  }]
};


function Blocklist() {
  let blocklist = Cc["@mozilla.org/extensions/blocklist;1"].
                  getService().wrappedJSObject;
  blocklist._clear();
  return blocklist;
}


function run_test() {
  // Some blocklist code rely on gApp.ID.
  createAppInfo(TEST_APP_ID, "XPCShell", "1", "1");
  // Disable blocklist via AMO.
  Services.prefs.setBoolPref(PREF_BLOCKLIST_VIA_AMO, false);

  // Starts addons manager.
  startupManager();

  // Clean-up for profile data.
  do_register_cleanup(function() {
    for(let filename of ['blocklist-addons.json', 'blocklist-plugins.json']) {
      const file = FileUtils.getFile(KEY_PROFILEDIR, [filename]);
      if (file.exists()) file.remove(true);
    }
  });

  run_next_test();
}


add_task(function* test_addon_entry_from_json_simple() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_ADDON_RECORD);

  const entry = blocklist._handleAddonItemJSON(data);

  equal(entry.blockID, SAMPLE_ADDON_RECORD.blockID);
  equal(entry.prefs, SAMPLE_ADDON_RECORD.prefs);
  equal(entry.attributes.get("id"), SAMPLE_ADDON_RECORD.guid);
  equal(entry.versions.length, 1);
  const item = entry.versions[0];
  equal(item.minVersion, "0");
  equal(item.maxVersion, "*");
  equal(item.severity, "1");
  equal(item.vulnerabilityStatus, "0");
  equal(item.targetApps["{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"].minVersion, "0.1");
  equal(item.targetApps["{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"].maxVersion, "17.*");
});


add_task(function* test_addon_entry_from_json_no_version_range() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_ADDON_RECORD);
  data.versionRange = [];

  const entry = blocklist._handleAddonItemJSON(data);

  equal(entry.versions.length, 1);
  const item = entry.versions[0];
  equal(item.minVersion, null);
  equal(item.maxVersion, null);
  equal(item.severity, 3);
  equal(item.vulnerabilityStatus, 0);
  equal(item.targetApps[TEST_APP_ID].minVersion, null);
  equal(item.targetApps[TEST_APP_ID].maxVersion, null);
});


add_task(function* test_addon_entry_from_json_without_blockid() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_ADDON_RECORD);
  delete data.blockID;

  const entry = blocklist._handleAddonItemJSON(data);

  equal(entry.blockID, SAMPLE_ADDON_RECORD.id);
});


add_task(function* test_addon_entry_without_target_application() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_ADDON_RECORD);
  data.versionRange[0].targetApplication = [];

  const entry = blocklist._handleAddonItemJSON(data);

  const item = entry.versions[0];
  equal(item.minVersion, "0");
  equal(item.maxVersion, "*");
  equal(item.severity, "1");
  equal(item.targetApps[TEST_APP_ID].minVersion, null);
  equal(item.targetApps[TEST_APP_ID].maxVersion, null);
});


add_task(function* test_plugin_entry_from_json_simple() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_PLUGIN_RECORD);

  const entry = blocklist._handlePluginItemJSON(data);

  equal(entry.blockID, SAMPLE_PLUGIN_RECORD.blockID);
  equal(entry.infoURL, SAMPLE_PLUGIN_RECORD.infoURL);
  equal(entry.matches['filename'].constructor.name, "RegExp");
  equal(entry.versions.length, 1);
  const item = entry.versions[0];
  equal(item.minVersion, "0");
  equal(item.maxVersion, "14.2.0");
  equal(item.severity, "1");
  equal(item.targetApps["{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"].minVersion, "0.1");
  equal(item.targetApps["{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"].maxVersion, "17.*");
});


add_task(function* test_plugin_entry_from_json_no_match() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_PLUGIN_RECORD);
  delete data.matchFilename;

  const entry = blocklist._handlePluginItemJSON(data);

  equal(entry, undefined);
});


add_task(function* test_plugin_entry_from_json_no_version_range() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_PLUGIN_RECORD);
  data.versionRange = [];

  const entry = blocklist._handlePluginItemJSON(data);

  equal(entry.versions.length, 1);
  const item = entry.versions[0];
  equal(item.minVersion, null);
  equal(item.maxVersion, null);
  equal(item.severity, 3);
  equal(item.targetApps[TEST_APP_ID].minVersion, null);
  equal(item.targetApps[TEST_APP_ID].maxVersion, null);
});


add_task(function* test_plugin_entry_from_json_without_blockid() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_PLUGIN_RECORD);
  delete data.blockID;

  const entry = blocklist._handlePluginItemJSON(data);

  equal(entry.blockID, SAMPLE_PLUGIN_RECORD.id);
});


add_task(function* test_plugin_entry_without_target_application() {
  const blocklist = Blocklist();
  const data = Object.assign({}, SAMPLE_PLUGIN_RECORD);
  data.versionRange[0].targetApplication = [];

  const entry = blocklist._handlePluginItemJSON(data);

  const item = entry.versions[0];
  equal(item.minVersion, "0");
  equal(item.maxVersion, "14.2.0");
  equal(item.severity, "1");
  equal(item.targetApps[TEST_APP_ID].minVersion, null);
  equal(item.targetApps[TEST_APP_ID].maxVersion, null);
});


add_task(function* test_is_loaded_synchronously() {
  const blocklist = Blocklist();
  strictEqual(blocklist._isBlocklistLoaded(), false);
  // Calls synchronous method from Interface.
  blocklist.isAddonBlocklisted("addon", "appVersion", "toolkitVersion");
  strictEqual(blocklist._isBlocklistLoaded(), true);
});


add_task(function* test_relies_on_handle_json_methods() {
  copyToApp(OLD, "addons");
  const blocklist = Blocklist();
  const sample = {viaJson: true};

  // mocking the handlers
  let old_handleAddonItemJSON = blocklist._handleAddonItemJSON;
  let old_handlePluginItemJSON = blocklist._handlePluginItemJSON;
  blocklist._handleAddonItemJSON = () => sample;
  blocklist._handlePluginItemJSON = () => sample;

  Services.prefs.setBoolPref(PREF_BLOCKLIST_VIA_AMO, false);
  blocklist.observe(null, "nsPref:changed", PREF_BLOCKLIST_VIA_AMO);

  try {
    blocklist._loadBlocklist();
    equal(blocklist._addonEntries[0], sample);
    equal(blocklist._pluginEntries[0], sample);
  }
  finally {
    blocklist._handleAddonItemJSON = old_handleAddonItemJSON;
    blocklist._handlePluginItemJSON = old_handlePluginItemJSON;
  }
});


add_task(function* test_relies_on_xml_when_pref_is_disabled() {
  const blocklist = Blocklist();
  var called = false;

  // XXX: sinon.stub ?
  const savedLoadXMLString = blocklist._loadBlocklistFromXMLString;
  blocklist._loadBlocklistFromXMLString = () => {called = true};

  // Notify change of preference:
  Services.prefs.setBoolPref(PREF_BLOCKLIST_VIA_AMO, true);
  blocklist.observe(null, "nsPref:changed", PREF_BLOCKLIST_VIA_AMO);

  strictEqual(called, true);

  // Restore mocks.
  blocklist._loadBlocklistFromXMLString = savedLoadXMLString;
  Services.prefs.setBoolPref(PREF_BLOCKLIST_VIA_AMO, false);
  blocklist.observe(null, "nsPref:changed", PREF_BLOCKLIST_VIA_AMO);
});


add_task(function* test_notify_does_not_download_xml_file() {
  const blocklist = Blocklist();
  strictEqual(blocklist._isBlocklistLoaded(), false);
  // When managed with Kinto, nothing is loaded/downloaded on notify.
  blocklist.notify(null);
  strictEqual(blocklist._isBlocklistLoaded(), false);
});


add_task(function* preload_json_async() {
  const blocklist = Blocklist();

  yield blocklist._preloadBlocklist();

  // Preloaded content comes from app dir.
  const addonsAppPath = FileUtils.getFile(KEY_APPDIR, ['blocklist-addons.json']).path;
  const pluginsAppPath = FileUtils.getFile(KEY_APPDIR, ['blocklist-plugins.json']).path;
  strictEqual(blocklist._preloadedBlocklistContent[addonsAppPath].length > 0, true);
  strictEqual(blocklist._preloadedBlocklistContent[pluginsAppPath].length > 0, true);
});


add_task(function* preload_json_reads_profile_data() {
  const blocklist = Blocklist();

  // Write some JSON content in profile dir.
  const fileContent = JSON.stringify({data: [SAMPLE_ADDON_RECORD]});
  const path = OS.Path.join(OS.Constants.Path.profileDir, 'blocklist-addons.json');
  yield OS.File.writeAtomic(path, fileContent, {tmpPath: path + ".tmp"});

  yield blocklist._preloadBlocklist();

  // Preloaded content comes from profile dir file.
  strictEqual(blocklist._preloadedBlocklistContent[path], fileContent);
  // Clean-up: delete created file.
  FileUtils.getFile(KEY_PROFILEDIR, ['blocklist-addons.json']).remove(true);
});


add_task(function* load_uses_preloaded_json_if_available() {
  const blocklist = Blocklist();

  // Simulate preload of data.
  const addonsAppPath = FileUtils.getFile(KEY_APPDIR, ['blocklist-addons.json']).path;
  const pluginsAppPath = FileUtils.getFile(KEY_APPDIR, ['blocklist-plugins.json']).path;
  blocklist._preloadedBlocklistContent[addonsAppPath] = JSON.stringify({data: [SAMPLE_ADDON_RECORD]});
  blocklist._preloadedBlocklistContent[pluginsAppPath] = JSON.stringify({data: [SAMPLE_PLUGIN_RECORD]});

  blocklist._loadBlocklist();

  // Data loaded comes from preloaded content.
  equal(blocklist._addonEntries[0].blockID, "i446");
  equal(blocklist._pluginEntries[0].blockID, "p123");
});


add_task(function* test_invalid_json() {
  const blocklist = Blocklist();

  // Simulate invalid json in preloaded data from app dir:
  const addonsAppPath = FileUtils.getFile(KEY_APPDIR, ['blocklist-addons.json']).path;
  blocklist._preloadedBlocklistContent[addonsAppPath] = '{>invalid}';

  blocklist._loadBlocklist();

  // Nothin was loaded.
  deepEqual(blocklist._addonEntries, []);
});


add_test(function test_blocklist_is_reloaded_when_message_is_received() {
  const blocklist = Blocklist();

  blocklist._loadBlocklist();

  // Write a fake JSON file in profile dir.
  const fileContent = JSON.stringify({data: [SAMPLE_ADDON_RECORD]});
  const path = OS.Path.join(OS.Constants.Path.profileDir, 'blocklist-addons.json');
  OS.File.writeAtomic(path, fileContent, {tmpPath: path + ".tmp"})
    .then(() => {
      // Send message.
      Services.cpmm.sendAsyncMessage("Blocklist:reload-from-disk");
    });

  // Since message is loaded asynchronously, wait for its reception.
  setTimeout(() => {
    // Blocklist was reloaded with the content from file.
    equal(blocklist._addonEntries[0].blockID, SAMPLE_ADDON_RECORD.blockID);

    run_next_test();
  }, 100);
});


// name can be addons or plugins
function clearBlocklists(name) {
  let filename = "blocklist-" + name + ".json";
  let blocklist = FileUtils.getFile(KEY_APPDIR, [filename]);
  if (blocklist.exists())
    blocklist.remove(true);

  blocklist = FileUtils.getFile(KEY_PROFILEDIR, [filename]);
  if (blocklist.exists())
    blocklist.remove(true);
}

function reloadBlocklist() {
  Services.prefs.setBoolPref(PREF_BLOCKLIST_ENABLED, false);
  Services.prefs.setBoolPref(PREF_BLOCKLIST_ENABLED, true);
}

function copyToApp(file, name) {
  let filename = "blocklist-" + name + ".json";
  file = file.clone();
  file.copyTo(gAppDir, filename);
}


function copyToProfile(file, tstamp, name) {
  let filename = "blocklist-" + name + ".json";
  file = file.clone();
  file.copyTo(gProfDir, filename);
  file = gProfDir.clone();
  file.append(filename);
  file.lastModifiedTime = tstamp;
}



add_task(function* test_read_json_from_app_or_profile() {
  const blocklist = Blocklist();
  copyToProfile(OLD, OLD_TSTAMP, "addons");
  blocklist._loadBlocklist();
  do_check_eq(blocklist._addonEntries.length, 416);

  // reading from profile
  clearBlocklists("addons");
  copyToProfile(NEW, NEW_TSTAMP, "addons");
  blocklist._loadBlocklist();
  // we should have one more
  do_check_eq(blocklist._addonEntries.length, 417);

  // reading from profile
  clearBlocklists("addons");
  copyToApp(OLD, "addons");
  blocklist._loadBlocklist();
  do_check_eq(blocklist._addonEntries.length, 416);
});


// add_task(function* test_invalid_json() {
//
// });
