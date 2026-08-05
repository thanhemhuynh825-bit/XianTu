'use strict';
/* 打包后应用图标/版本信息：electron-builder 跳过资源编辑时的替代方案（resedit 纯 JS） */
const fs = require('fs');
const path = require('path');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

const exePath = process.argv[2];
if (!exePath) { console.error('用法: node apply-icon.js <exe路径>'); process.exit(1); }

const iconPath = path.join(__dirname, 'build', 'icon.ico');
const data = fs.readFileSync(exePath);
const exe = NtExecutable.from(data);
const res = NtExecutableResource.from(exe);

/* 图标 */
const iconFile = Resource.IconFile.from(fs.readFileSync(iconPath));
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1, // 语言
  iconFile.icons.map(i => i.data),
);
Resource.IconEntry.replaceIconsForResource(res.entries, iconFile.icons.map(i => i.data));

/* 版本信息 */
const vi = Resource.VersionInfo.createLanguageFileInstance(0x0804, 1200, {
  CompanyName: '仙途',
  FileDescription: '仙途 - AI 实时演绎修仙文字世界',
  FileVersion: '1.3.0.0',
  InternalName: 'XianTu',
  OriginalFilename: 'XianTu.exe',
  ProductName: '仙途',
  ProductVersion: '1.3.0.0',
}, {
  FileVersion: '1.3.0.0',
  ProductVersion: '1.3.0.0',
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
const out = exe.generate();
fs.writeFileSync(exePath, out);
console.log('图标与版本信息已写入:', exePath, `(${out.length} 字节)`);
