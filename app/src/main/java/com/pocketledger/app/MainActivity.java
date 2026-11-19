package com.pocketledger.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * PocketLedger shell.
 *
 * The whole UI is a bundled offline web app (assets/app). Native code only does
 * the things a web page cannot: writing exports into the public Downloads
 * folder, opening a URL in the real browser, and handling the back button.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_STORAGE_PERMISSION = 1002;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

    // Pending export, replayed once the storage permission is granted (API <= 28).
    private String pendingName, pendingMime, pendingContent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F6F7F8"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Only the bundled page is allowed inside the WebView.
                if (url.startsWith("file://")) return false;
                openExternally(url);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(
                            Intent.createChooser(intent, "选择备份文件"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }

            // WebView silently drops window.confirm() without these handlers.
            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                showDialog(message, false, result);
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                showDialog(message, true, result);
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Native");
        web.loadUrl("file:///android_asset/app/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        // Let the page decide: close the sheet / go back to the list / exit.
        web.evaluateJavascript(
                "(function(){try{return window.pocketBack?window.pocketBack():'exit'}catch(e){return 'exit'}})()",
                value -> {
                    boolean handled = value != null && value.contains("handled");
                    if (!handled) moveTaskToBack(true);
                });
    }

    private void showDialog(String message, boolean confirm, final JsResult result) {
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setMessage(message)
                .setCancelable(true)
                .setOnCancelListener(d -> result.cancel());
        if (confirm) {
            b.setPositiveButton("确定", (d, w) -> result.confirm());
            b.setNegativeButton("取消", (d, w) -> result.cancel());
        } else {
            b.setPositiveButton("好", (d, w) -> result.confirm());
        }
        b.show();
    }

    private void openExternally(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            toast("无法打开链接");
        }
    }

    private void toast(final String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
    }

    /** JS bridge exposed as window.Native. */
    private class Bridge {

        @JavascriptInterface
        public String version() {
            return "1.0.0";
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url != null && (url.startsWith("https://") || url.startsWith("http://"))) {
                final String target = url;
                runOnUiThread(() -> openExternally(target));
            }
        }

        @JavascriptInterface
        public void toast(String message) {
            MainActivity.this.toast(message == null ? "" : message);
        }

        /**
         * Writes a UTF-8 text file into the public Downloads folder.
         * Returns a short message for the page to display.
         */
        @JavascriptInterface
        public String saveFile(String name, String mime, String content) {
            if (name == null || name.isEmpty()) name = "pocket-ledger.txt";
            final String safeName = name.replaceAll("[\\\\/:*?\"<>|]", "_");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE,
                            mime == null || mime.isEmpty() ? "text/plain" : mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/口袋账本");
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "保存失败：无法创建文件";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) return "保存失败：无法写入";
                        out.write(("".equals(content) || content == null ? "" : content)
                                .getBytes(StandardCharsets.UTF_8));
                        out.flush();
                    }
                    return "已保存到 Download/口袋账本/" + safeName;
                } catch (Exception e) {
                    return "保存失败：" + e.getMessage();
                }
            }

            // Android 9 and below: legacy public Downloads directory.
            // API 21/22 grant storage at install time, API 23+ needs a runtime prompt.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingName = safeName;
                pendingMime = mime;
                pendingContent = content;
                requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQ_STORAGE_PERMISSION);
                return "正在请求存储权限，允许后再点一次导出";
            }

            try {
                File dir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return "保存失败：无法创建目录";
                File file = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(content == null ? new byte[0]
                            : content.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }
                return "已保存到 Download/" + safeName;
            } catch (Exception e) {
                return "保存失败：" + e.getMessage();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_STORAGE_PERMISSION) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (!granted) {
            toast("没有存储权限，无法导出");
            return;
        }
        if (pendingContent != null) {
            String msg = new Bridge().saveFile(pendingName, pendingMime, pendingContent);
            toast(msg);
            pendingName = pendingMime = pendingContent = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
