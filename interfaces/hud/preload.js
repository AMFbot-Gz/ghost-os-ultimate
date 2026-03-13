/**
 * preload.js — Bridge Electron contextIsolation
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("laruche", {
  onHudEvent: (callback) => {
    ipcRenderer.on("hud-event", (event, data) => callback(data));
  },
  sendHitlResponse: (approved, missionId) => {
    ipcRenderer.send("hitl-response", { approved, missionId });
  },
});
