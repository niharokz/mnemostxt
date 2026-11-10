#!/usr/bin/env python3
"""Prepare app/gen/android for a release build (run inside the builder image).

Tauri generates the Android project (`tauri android init`); it is not kept in
git. This script creates it when missing and applies mnemostxt's changes:

  1. storage permissions (All files access) in AndroidManifest.xml
  1b. the share target (ShareActivity: "Share to mnemostxt" saves into the inbox)
  2. our MainActivity.kt (access, insets, folder picker, lock, JS bridge) and
     ShareActivity.kt
  2a. androidx.biometric for the lock (fingerprint, face or screen lock)
  2c. a ProGuard rule keeping the JavaScript bridge in release builds
  2d. the home-screen widgets (0.0.3): Kotlin in app/android/*.kt, resources
      in app/android/res/ (layouts, widget infos, background), and their
      receivers, list service, settings and capture activities in the manifest
  2e. the name people see: MnemoTXT (strings.xml, share label)
  2b. the Gradle task that calls back into the Tauri CLI: point it at the real
      CLI file (started as `node <file>`, Tauri records just "tauri")
  3. the launcher icons from app/icons/android
  4. release signing from keystore.properties (written from the key folder)

Every step is idempotent: running it twice changes nothing more.
Usage: python3 scripts/android-prepare.py [--keys DIR]
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
GEN = APP / "gen" / "android"
TAURI = ROOT / "frontend" / "node_modules" / ".bin" / "tauri"
MARK = "mnemostxt:"


def die(msg):
    print(f"android-prepare: {msg}", file=sys.stderr)
    sys.exit(1)


def init():
    gradle = GEN / "app" / "build.gradle.kts"
    if gradle.exists() and MARK in gradle.read_text() and SIGNING_MARK not in gradle.read_text():
        print("android-prepare: patched by an older version — regenerating app/gen/android")
        shutil.rmtree(GEN)
    if gradle.exists():
        return
    if not TAURI.exists():
        die("run `npm ci` in frontend/ first (it installs the Tauri CLI)")
    print("android-prepare: generating app/gen/android (tauri android init)")
    if subprocess.run([str(TAURI), "android", "init", "--ci"], cwd=APP).returncode != 0:
        die("`tauri android init` failed (its message is just above)")


def manifest():
    p = GEN / "app" / "src" / "main" / "AndroidManifest.xml"
    s = p.read_text()
    if MARK in s:
        return
    if 'xmlns:tools=' not in s:
        s = s.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
    perms = (
        f"    <!-- {MARK} the notes folder lives in shared storage -->\n"
        '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n'
        '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />\n'
        '    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:ignore="ScopedStorage" />\n'
    )
    s, n = re.subn(r"(\s*<application\b)", "\n" + perms + r"\1", s, count=1)
    if not n:
        die(f"no <application> in {p}")
    s = re.sub(r"<application\b", '<application android:requestLegacyExternalStorage="true"', s, count=1)
    # the activity resizes with the keyboard
    if "windowSoftInputMode" not in s:
        s = re.sub(r'(<activity\b[^>]*android:name="\.MainActivity")', r'\1 android:windowSoftInputMode="adjustResize"', s, count=1)
    p.write_text(s)
    print("android-prepare: manifest patched")


SHARE_MARK = "mnemostxt-share-v1"
SHARE = f"""
        <!-- {SHARE_MARK}: "Share to mnemostxt" saves into the inbox folder (app/android/ShareActivity.kt) -->
        <activity
            android:name=".ShareActivity"
            android:exported="true"
            android:label="Save to MnemoTXT"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
        </activity>
"""


def share_target():
    p = GEN / "app" / "src" / "main" / "AndroidManifest.xml"
    s = p.read_text()
    if SHARE_MARK in s:
        return
    s, n = re.subn(r"(\n\s*</application>)", SHARE.rstrip("\n") + r"\1", s, count=1)
    if not n:
        die(f"no </application> in {p}")
    p.write_text(s)
    print("android-prepare: share target added")


def activity():
    """Every app/android/*.kt next to the generated MainActivity.kt (which ours replaces)."""
    found = list((GEN / "app" / "src" / "main").rglob("MainActivity.kt"))
    if not found:
        die("MainActivity.kt not found in the generated project")
    names = []
    for kt in sorted((APP / "android").glob("*.kt")):
        shutil.copyfile(kt, found[0].parent / kt.name)
        names.append(kt.name)
    print(f"android-prepare: {', '.join(names)} copied to {found[0].parent.relative_to(ROOT)}")


def resources():
    """app/android/res/** (widget layouts, infos, drawables) into the generated res/."""
    src = APP / "android" / "res"
    res = GEN / "app" / "src" / "main" / "res"
    n = 0
    for f in src.rglob("*"):
        if f.is_file():
            dest = res / f.relative_to(src)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, dest)
            n += 1
    print(f"android-prepare: {n} widget resources copied")


WIDGETS_MARK = "mnemostxt-widgets-v1"
WIDGET_RECEIVERS = [
    ("RecentWidget2x2", "Recent files (2×2)", "recent_2x2"),
    ("RecentWidget3x2", "Recent files (3×2)", "recent_3x2"),
    ("RecentWidget4x2", "Recent files (4×2)", "recent_4x2"),
    ("PinnedWidget2x2", "Pinned note (2×2)", "pinned_2x2"),
    ("PinnedWidget4x2", "Pinned note (4×2)", "pinned_4x2"),
    ("CaptureWidget4x1", "Quick capture (4×1)", "capture_4x1"),
]


def widgets():
    p = GEN / "app" / "src" / "main" / "AndroidManifest.xml"
    s = p.read_text()
    changed = False
    # widget taps reach the running app (onNewIntent) instead of a second copy:
    # exactly one launchMode="singleTask" on MainActivity, wherever Tauri put its
    # own (0.0.3's first build added a duplicate, which is invalid XML)
    def single_task(m):
        tag = m.group(0)
        if 'android:name=".MainActivity"' not in tag:
            return tag
        bare = re.sub(r'\s+android:launchMode="[^"]*"', "", tag)
        return re.sub(r"^<activity\b", '<activity android:launchMode="singleTask"', bare)
    s2 = re.sub(r"<activity\b[^>]*>", single_task, s, flags=re.S)
    changed = s2 != s
    s = s2
    if WIDGETS_MARK not in s:
        parts = [f"\n        <!-- {WIDGETS_MARK}: home-screen widgets (app/android/Widgets.kt) -->"]
        for cls, label, xml in WIDGET_RECEIVERS:
            parts.append(f'''        <receiver android:name=".{cls}" android:exported="false" android:label="{label}">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/mnemostxt_widget_{xml}" />
        </receiver>''')
        parts.append('''        <service android:name=".WidgetListService" android:exported="false" android:permission="android.permission.BIND_REMOTEVIEWS" />
        <activity
            android:name=".WidgetConfigActivity"
            android:exported="true"
            android:label="Widget settings"
            android:excludeFromRecents="true"
            android:theme="@android:style/Theme.Material.NoActionBar">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_CONFIGURE" />
            </intent-filter>
        </activity>
        <activity
            android:name=".CaptureActivity"
            android:exported="false"
            android:label="Quick capture"
            android:excludeFromRecents="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.Material.Dialog.NoActionBar"
            android:windowSoftInputMode="stateVisible|adjustResize" />''')
        block = "\n".join(parts)
        s, n = re.subn(r"(\n\s*</application>)", lambda m: block + m.group(1), s, count=1)
        if not n:
            die(f"no </application> in {p}")
        changed = True
    if changed:
        p.write_text(s)
        print("android-prepare: widgets added to the manifest")


APP_NAME = "MnemoTXT"  # the name people see (frontend/src/core/brand.js)


def app_name():
    """The launcher and share-menu names: MnemoTXT (the package id stays ar.nih.mnemostxt)."""
    res = GEN / "app" / "src" / "main" / "res" / "values" / "strings.xml"
    if res.exists():
        s = res.read_text()
        s2 = re.sub(r'(<string name="(?:app_name|main_activity_title)">)[^<]*(</string>)', rf"\g<1>{APP_NAME}\g<2>", s)
        if s2 != s:
            res.write_text(s2)
            print(f"android-prepare: app name {APP_NAME}")
    p = GEN / "app" / "src" / "main" / "AndroidManifest.xml"
    m = p.read_text()
    m2 = m.replace('android:label="Save to mnemostxt"', f'android:label="Save to {APP_NAME}"')
    if m2 != m:
        p.write_text(m2)


def check_manifest():
    """Fails here, with the reason, rather than deep inside Gradle."""
    import xml.dom.minidom
    p = GEN / "app" / "src" / "main" / "AndroidManifest.xml"
    try:
        xml.dom.minidom.parse(str(p))
    except Exception as e:  # noqa: BLE001 - any parse error is fatal
        die(f"{p.relative_to(ROOT)} is not valid XML: {e}")


PROGUARD_MARK = "mnemostxt-bridge-v1"


def proguard():
    """Release builds shrink code: keep the methods the web page calls."""
    p = GEN / "app" / "proguard-rules.pro"
    s = p.read_text() if p.exists() else ""
    if PROGUARD_MARK in s:
        return
    s += (f"\n# {PROGUARD_MARK}: window.MnemostxtAndroid (MainActivity.kt) is called from JavaScript\n"
          "-keepclassmembers class ar.nih.mnemostxt.MainActivity$Bridge {\n"
          "    @android.webkit.JavascriptInterface <methods>;\n}\n")
    p.write_text(s)
    print("android-prepare: bridge kept in release builds")


BIOMETRIC_MARK = "mnemostxt-biometric-v1"
BIOMETRIC = 'androidx.biometric:biometric:1.1.0'


def dependencies():
    p = GEN / "app" / "build.gradle.kts"
    s = p.read_text()
    if BIOMETRIC_MARK in s:
        return
    s, n = re.subn(r"(\ndependencies\s*\{)", rf'\1\n    // {BIOMETRIC_MARK}: the lock (MainActivity.kt)\n    implementation("{BIOMETRIC}")', s, count=1)
    if not n:
        die(f"no dependencies block in {p}")
    p.write_text(s)
    print("android-prepare: androidx.biometric added")


# Gradle runs this from app/ (rootDirRel); the CLI lives in frontend/node_modules.
CLI_FROM_APP = "../frontend/node_modules/@tauri-apps/cli/tauri.js"


def build_task():
    found = list((GEN / "buildSrc").rglob("BuildTask.kt"))
    if not found:
        die("BuildTask.kt not found in app/gen/android/buildSrc")
    p = found[0]
    s = p.read_text()
    if CLI_FROM_APP in s:
        return
    s, n1 = re.subn(r'val executable = """[^"]*""";?', 'val executable = """node""";', s, count=1)
    s, n2 = re.subn(r'val args = listOf\([^)]*\);?',
                    f'val args = listOf("{CLI_FROM_APP}", "android", "android-studio-script");', s, count=1)
    if not (n1 and n2):
        die(f"unexpected BuildTask.kt layout in {p}")
    p.write_text(s)
    print("android-prepare: Gradle build task points at the Tauri CLI")


def icons():
    res = GEN / "app" / "src" / "main" / "res"
    src = APP / "icons" / "android"
    for d in src.iterdir():
        if d.is_dir():
            dest = res / d.name
            dest.mkdir(parents=True, exist_ok=True)
            for f in d.iterdir():
                shutil.copyfile(f, dest / f.name)
    print("android-prepare: launcher icons copied")


# Kotlin stdlib only: inside `android { }` the name `java` is Gradle's Java
# extension, so java.util.Properties does not resolve there.
SIGNING_MARK = "mnemostxt-signing-v2"
SIGNING = """
    // mnemostxt-signing-v2: release signing from keystore.properties (never committed)
    signingConfigs {
        create("release") {
            val ks = rootProject.file("keystore.properties")
            if (ks.exists()) {
                val p = ks.readLines()
                    .filter { it.contains('=') && !it.trimStart().startsWith("#") }
                    .associate { it.substringBefore('=').trim() to it.substringAfter('=').trim() }
                storeFile = file(p.getValue("storeFile"))
                storePassword = p.getValue("storePassword")
                keyAlias = p.getValue("keyAlias")
                keyPassword = p.getValue("keyPassword")
            }
        }
    }
"""


def signing():
    p = GEN / "app" / "build.gradle.kts"
    s = p.read_text()
    if SIGNING_MARK in s:
        return
    s, n = re.subn(r"(\n\s*buildTypes\s*\{)", SIGNING.rstrip("\n") + r"\1", s, count=1)
    if not n:
        die(f"no buildTypes block in {p}")
    s, n = re.subn(r'(getByName\("release"\)\s*\{)', r'\1\n            signingConfig = signingConfigs.getByName("release")', s, count=1)
    if not n:
        die(f'no getByName("release") in {p}')
    p.write_text(s)
    print("android-prepare: release signing added")


def keystore(keys):
    """keystore.env holds MNEMOSTXT_STORE_PASSWORD, MNEMOSTXT_KEY_PASSWORD, MNEMOSTXT_KEY_ALIAS."""
    if not keys:
        return
    keys = Path(keys)
    env = {}
    for line in (keys / "keystore.env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    jks = keys / "mnemostxt.jks"
    if not jks.exists():
        die(f"{jks} missing — run scripts/make-keystore.sh first")
    props = (
        f"storeFile={jks}\n"
        f"storePassword={env['MNEMOSTXT_STORE_PASSWORD']}\n"
        f"keyAlias={env.get('MNEMOSTXT_KEY_ALIAS', 'mnemostxt')}\n"
        f"keyPassword={env.get('MNEMOSTXT_KEY_PASSWORD', env['MNEMOSTXT_STORE_PASSWORD'])}\n"
    )
    out = GEN / "keystore.properties"
    out.write_text(props)
    os.chmod(out, 0o600)
    print("android-prepare: keystore.properties written")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="folder with mnemostxt.jks and keystore.env")
    a = ap.parse_args()
    init()
    manifest()
    share_target()
    widgets()
    app_name()
    check_manifest()
    activity()
    resources()
    dependencies()
    proguard()
    build_task()
    icons()
    signing()
    keystore(a.keys)
