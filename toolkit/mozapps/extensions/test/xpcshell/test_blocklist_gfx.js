const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const TEST_APP_ID            = "xpcshell@tests.mozilla.org";


const SAMPLE_GFX_RECORD = {
  "driverVersionComparator": "LESS_THAN_OR_EQUAL",
  "driverVersion": "8.17.12.5896",
  "vendor": "0x10de",
  "blockID": "g36",
  "feature": "DIRECT3D_9_LAYERS",
  "devices": ["0x0a6c", "geforce"],
  "featureStatus": "BLOCKED_DRIVER_VERSION",
  "last_modified": 1458035931837,
  "os": "WINNT 6.1",
  "id": "3f947f16-37c2-4e96-d356-78b26363729b",
  "versionRange": {"minVersion": null, "maxVersion": "*"}
};


function Blocklist() {
  let blocklist = Cc["@mozilla.org/extensions/blocklist;1"].
                  getService().wrappedJSObject;
  blocklist._clear();
  return blocklist;
}


function run_test() {
  run_next_test();
}


add_task(function* test_sends_serialized_data() {
  const blocklist = Blocklist();
  blocklist._gfxEntries = [SAMPLE_GFX_RECORD];

  const eventName = "blocklist-data-gfxItems";
  const expected = "blockID:g36\tdevices:0x0a6c,geforce\tdriverVersion:8.17.12.5896\t" +
                   "driverVersionComparator:LESS_THAN_OR_EQUAL\tfeature:DIRECT3D_9_LAYERS\t" +
                   "featureStatus:BLOCKED_DRIVER_VERSION\tos:WINNT 6.1\tvendor:0x10de\t" +
                   "versionRange:,*";
  let received;
  const observe = (subject, topic, data) => { received = data };
  Services.obs.addObserver(observe, eventName, false);
  blocklist._notifyObserversBlocklistGFX();
  equal(received, expected);
  Services.obs.removeObserver(observe, eventName);
});
