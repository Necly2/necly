#!/bin/bash
# Сборка NeSpat.app (универсальная: Apple Silicon + Intel).
set -e
cd "$(dirname "$0")"
APP="build/NeSpat.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" build/tmp
for ARCH in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$ARCH-apple-macos13.0" -framework Cocoa -framework IOKit -framework ServiceManagement \
    Sources/*.swift -o "build/tmp/NeSpat-$ARCH"
done
lipo -create build/tmp/NeSpat-arm64 build/tmp/NeSpat-x86_64 -output "$APP/Contents/MacOS/NeSpat"
rm -rf build/tmp
cp Info.plist "$APP/Contents/Info.plist"
if [ -n "$BUILD_NUMBER" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.$BUILD_NUMBER" "$APP/Contents/Info.plist"
fi
codesign --force -s - "$APP"
echo "Готово: $APP"
