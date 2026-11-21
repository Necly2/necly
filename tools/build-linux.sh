#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
arch=$(dpkg --print-architecture)
case "$arch" in
  arm64) electron_arch=arm64 ;;
  amd64) electron_arch=x64 ;;
  *) echo "Unsupported build architecture: $arch" >&2; exit 1 ;;
esac
version=$(node -p 'require("./package.json").version')
mkdir -p dist
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
npx --no-install electron-packager . pvz-master --platform=linux --arch="$electron_arch" \
  --asar --out=dist --overwrite \
  --ignore='^/(dist|tools|build|\.agents|\.github|\.claude)(/|$)' --ignore='\.md$'
install -d "$stage"/{DEBIAN,opt,usr/bin,usr/share/applications,usr/share/pixmaps}
cp -a "dist/pvz-master-linux-$electron_arch" "$stage/opt/pvz-master"
test -x "$stage/opt/pvz-master/pvz-master"
chmod 4755 "$stage/opt/pvz-master/chrome-sandbox"
ln -s /opt/pvz-master/pvz-master "$stage/usr/bin/pvz-master"
install -m644 src/icon.png "$stage/usr/share/pixmaps/pvz-master.png"
cat > "$stage/usr/share/applications/pvz-master.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=PVZ Master
Exec=/opt/pvz-master/pvz-master
Icon=pvz-master
Categories=Office;
Terminal=false
EOF
cat > "$stage/DEBIAN/control" <<EOF
Package: pvz-master
Version: $version
Architecture: $arch
Maintainer: Necly2 <Necly2@users.noreply.github.com>
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libgbm1, libxss1, libxtst6, libxkbcommon0, libdrm2, libxdamage1, libxrandr2, libxcomposite1, libxfixes3, libx11-xcb1, libxcb1, libatspi2.0-0 | libatspi2.0-0t64
Description: PVZ Master desktop application
EOF
dpkg-deb --root-owner-group -Zxz --build "$stage" "dist/pvz-master_${version}_${arch}.deb"
