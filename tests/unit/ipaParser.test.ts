import { describe, it, expect, beforeAll, afterAll } from "vitest";
import AdmZip from "adm-zip";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { parseIpa } from "../../src/parser/ipaParser.js";

const SAMPLE_PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Seri Mediclinic</string>
  <key>CFBundleName</key>
  <string>SeriMediclinic</string>
  <key>CFBundleIdentifier</key>
  <string>com.seri.mediclinic</string>
  <key>CFBundleVersion</key>
  <string>241</string>
  <key>CFBundleShortVersionString</key>
  <string>2.4.1</string>
  <key>MinimumOSVersion</key>
  <string>15.0</string>
  <key>DTPlatformVersion</key>
  <string>17.0</string>
  <key>get-task-allow</key>
  <false/>
</dict>
</plist>`;

describe("parseIpa", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-ipa-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("extracts metadata from a synthetic Info.plist (XML)", async () => {
    const ipaPath = path.join(tmpDir, "synthetic.ipa");
    const zip = new AdmZip();
    zip.addFile("Payload/Seri.app/Info.plist", Buffer.from(SAMPLE_PLIST_XML, "utf8"));
    zip.addFile("Payload/Seri.app/empty.bin", Buffer.alloc(64, 0xaa));
    zip.writeZip(ipaPath);

    const meta = await parseIpa(ipaPath);
    expect(meta.appName).toBe("Seri Mediclinic");
    expect(meta.packageName).toBe("com.seri.mediclinic");
    expect(meta.versionName).toBe("2.4.1");
    expect(meta.versionCode).toBe("241");
    expect(meta.buildType).toBe("release");
    expect(meta.minSdkVersion).toBe("15.0");
    expect(meta.targetSdkVersion).toBe("17.0");
    expect(meta.source).toBe("ipa-plist");
  });

  it("falls back to filename heuristics when Info.plist is missing", async () => {
    const ipaPath = path.join(tmpDir, "broken_v1.0.0.ipa");
    const zip = new AdmZip();
    zip.addFile("Payload/Foo.app/empty.bin", Buffer.alloc(32, 0));
    zip.writeZip(ipaPath);

    const meta = await parseIpa(ipaPath);
    expect(meta.source).toBe("filename-fallback");
    expect(meta.versionName).toBe("1.0.0");
  });

  it("falls back when the archive is corrupt", async () => {
    const ipaPath = path.join(tmpDir, "corrupt_v9.9.9.ipa");
    await fs.writeFile(ipaPath, Buffer.from("not actually a zip"));

    const meta = await parseIpa(ipaPath);
    expect(meta.source).toBe("filename-fallback");
    expect(meta.versionName).toBe("9.9.9");
  });
});
