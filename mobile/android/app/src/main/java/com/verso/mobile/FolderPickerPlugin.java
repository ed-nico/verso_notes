package com.verso.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens Android's system folder picker (ACTION_OPEN_DOCUMENT_TREE) and returns
 * the picked folder as a real filesystem path. The app reads via all-files
 * access, so the picker is only for choosing — no SAF I/O needed.
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

  @PluginMethod
  public void pick(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    startActivityForResult(call, intent, "pickResult");
  }

  @ActivityCallback
  private void pickResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
      call.reject("cancelled");
      return;
    }
    Uri uri = result.getData().getData();
    // Tree doc ids look like "primary:Android/media/…" or "1A2B-3C4D:notes".
    String docId = DocumentsContract.getTreeDocumentId(uri);
    int colon = docId.indexOf(':');
    String volume = colon >= 0 ? docId.substring(0, colon) : docId;
    String rel = colon >= 0 ? docId.substring(colon + 1) : "";
    String path = "primary".equals(volume)
      ? "/storage/emulated/0" + (rel.isEmpty() ? "" : "/" + rel)
      : "/storage/" + volume + (rel.isEmpty() ? "" : "/" + rel);
    JSObject ret = new JSObject();
    ret.put("path", path);
    call.resolve(ret);
  }
}
