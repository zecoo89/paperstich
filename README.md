# PaperStich

## About PaperStich

PaperStich combines the images for each monitor into a single wallpaper that matches your complete desktop layout, then applies it as your desktop background.

Choose an image for each monitor, preview the complete layout, and apply the wallpaper with one click. It is useful for displaying a panoramic image across multiple monitors or a different image on each display.

Canvas-based multi-monitor wallpaper application for Linux, built with Tauri, TypeScript, and Rust.

[日本語版](README.ja.md)

## Features

- Detects active monitors through XRandR
- Loads PNG, JPEG, and WebP images recursively from multiple directories
- Adds image directories by drag and drop
- Assigns a different image to each monitor
- Supports fill, fit, and centered native-size display modes
- Combines the complete desktop layout into a single PNG wallpaper
- Applies wallpapers through GSettings on GNOME, Cinnamon, and MATE
- Remembers selected image directories and monitor assignments

## Supported environment

- Linux / X11
- An environment with `xrandr`
- GNOME, Cinnamon, or MATE
- Wayland is not currently supported

Wallpaper application also requires `gsettings`.

## Usage

1. Click **Add image directories** and select one or more image directories, or drag directories onto the application window.
2. Click a monitor in the preview.
3. Click an image to assign it to the selected monitor.
4. Choose a display mode if needed, then click **Apply wallpaper**.

The merged image is saved to `$XDG_CACHE_HOME/paperstich/merged.png`, or `~/.cache/paperstich/merged.png` when `XDG_CACHE_HOME` is not set.

## Run from source

### Prerequisites on Debian / Ubuntu

Tauri requires WebKitGTK and other system packages to build:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Use Rust via rustup and Node.js 18 or later.

### Development server

```sh
npm install
npm run dev
```

To run the desktop application:

```sh
npm run tauri dev
```

### Build the application

To build a distributable application, run:

```sh
npm run tauri build
```

The built package is generated under `src-tauri/target/release/bundle/`. The current configuration generates a Debian package (`.deb`).

Build the frontend and run the Rust checks:

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Limitations

- PNG, JPEG, and WebP images are supported.
- Up to 500 images can be loaded, with a maximum file size of 50 MiB per image.
- Selected image directories are stored as absolute paths in the application's local settings.
- Wayland is not supported at this time.
- This software is provided "as is", without warranty.

## License

PaperStich is licensed under the MIT License. See [LICENSE](LICENSE).
