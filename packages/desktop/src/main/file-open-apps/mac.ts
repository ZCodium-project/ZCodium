/** NSWorkspace 直接读取 Launch Services 的文件关联，绝不维护应用白名单。 */
export const MAC_APPLICATION_QUERY = `
ObjC.import('AppKit');
function run(argv) {
  var file = $.NSURL.fileURLWithPath(argv[0]);
  var workspace = $.NSWorkspace.sharedWorkspace;
  var urls = workspace.URLsForApplicationsToOpenURL(file);
  var defaultUrl = workspace.URLForApplicationToOpenURL(file);
  var defaultPath = defaultUrl ? ObjC.unwrap(defaultUrl.URLByResolvingSymlinksInPath.path) : '';
  var result = [];
  for (var i = 0; i < urls.count; i++) {
    var url = urls.objectAtIndex(i);
    var bundle = $.NSBundle.bundleWithURL(url);
    var path = ObjC.unwrap(url.URLByResolvingSymlinksInPath.path);
    var bundleId = ObjC.unwrap(bundle.bundleIdentifier);
    var version = bundle.objectForInfoDictionaryKey('CFBundleShortVersionString');
    var name = bundle.objectForInfoDictionaryKey('CFBundleDisplayName');
    if (!name) name = bundle.objectForInfoDictionaryKey('CFBundleName');
    result.push({
      key: path,
      iconPath: path,
      identity: bundleId ? 'darwin-bundle:' + bundleId.toLowerCase() : 'darwin-path:' + path,
      version: version ? ObjC.unwrap(version) : '',
      name: name ? ObjC.unwrap(name) : ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(url.path)),
      isDefault: path === defaultPath
    });
  }
  return JSON.stringify(result);
}`;
