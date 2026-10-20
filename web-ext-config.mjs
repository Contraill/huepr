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
    "**/__pycache__",
  ],
};
