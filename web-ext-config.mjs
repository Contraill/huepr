// web-ext build / sign settings: only the extension files go into the XPI.
export default {
  ignoreFiles: [
    "host",
    "screenshots",
    "install.sh",
    "uninstall.sh",
    "README.md",
    "updates.json",
    "web-ext-config.mjs",
    "amo-metadata.json",
    // written by .github/workflows/release.yml before signing
    "amo-metadata.release.json",
    "notes.md",
    "**/__pycache__",
  ],
};
