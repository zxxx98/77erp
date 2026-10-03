package com.erp77.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends ComponentActivity {
    private LinearLayout root;
    private WebView webView;
    private TextView status;
    private String serverOrigin;
    private Pending pending;
    private byte[] pendingFile;
    private final ExecutorService fileWriter = Executors.newSingleThreadExecutor();

    private record Pending(String id, JavaScriptReplyProxy reply) {}

    private final ActivityResultLauncher<String> cameraPermission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            if (pending == null) return;
            if (granted) this.scanner.launch(new Intent(this, ScannerActivity.class));
            else finishRequest(null, "摄像头权限未开启，请在系统设置中授权，或手动输入条码。");
        });

    private final ActivityResultLauncher<Intent> scanner = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            Intent data = result.getData();
            if (result.getResultCode() == RESULT_OK && data != null) {
                finishRequest(data.getStringExtra("barcode"), null);
            } else {
                String error = data == null ? null : data.getStringExtra("error");
                finishRequest(null, error == null ? "已取消扫码，可重新打开摄像头。" : error);
            }
        });

    private final ActivityResultLauncher<Intent> saveDocument = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            byte[] content = pendingFile;
            pendingFile = null;
            if (result.getResultCode() != RESULT_OK || result.getData() == null || content == null) {
                finishRequest(null, "已取消保存。");
                return;
            }
            Uri uri = result.getData().getData();
            Pending request = pending;
            fileWriter.execute(() -> {
                String error = null;
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new java.io.IOException("No output stream");
                    output.write(content);
                } catch (Exception e) {
                    error = "文件保存失败，请重试。";
                }
                String finalError = error;
                runOnUiThread(() -> {
                    if (pending == request) finishRequest("saved", finalError);
                });
            });
        });

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(247, 248, 250));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
        serverOrigin = getPreferences(MODE_PRIVATE).getString("server", "");
        if (serverOrigin.isEmpty()) showConnection();
        else showServer();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private TextView label(String text, int size) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(23, 36, 60));
        view.setPadding(dp(16), dp(12), dp(16), dp(12));
        return view;
    }

    private Button button(String title, Runnable action) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private void disposeWebView() {
        pending = null;
        pendingFile = null;
        if (webView != null) {
            root.removeView(webView);
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
    }

    private void showConnection() {
        disposeWebView();
        root.removeAllViews();
        root.addView(label("77 ERP", 28));
        root.addView(label("连接工作空间", 22));
        root.addView(label("填写已部署的 ERP 服务器地址，商品和库存保存在服务器。", 15));
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://erp.example.com");
        address.setText(serverOrigin);
        address.setContentDescription("服务器地址");
        LinearLayout.LayoutParams inputLayout = new LinearLayout.LayoutParams(-1, dp(56));
        inputLayout.setMargins(dp(16), dp(16), dp(16), dp(8));
        root.addView(address, inputLayout);
        root.addView(label("支持 HTTPS 和 HTTP。公网使用建议配置 HTTPS。地址只需域名或 IP 和端口，无需填写 /api。", 14));
        root.addView(button("连接服务器", () -> {
            try {
                String next = normalizeOrigin(address.getText().toString());
                if (next.equals(serverOrigin)) { showServer(); return; }
                // A different workspace must not inherit the previous workspace's session.
                CookieManager.getInstance().removeAllCookies(removed -> {
                    CookieManager.getInstance().flush();
                    serverOrigin = next;
                    getPreferences(MODE_PRIVATE).edit().putString("server", next).apply();
                    showServer();
                });
            } catch (Exception e) {
                address.setError("请输入完整的 http:// 或 https:// 地址，不包含路径、账号或参数。");
            }
        }));
        if (!serverOrigin.isEmpty()) root.addView(button("返回工作空间", this::showServer));
    }

    private static String normalizeOrigin(String input) throws Exception {
        URI uri = new URI(input.trim());
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
            || uri.getHost() == null || uri.getRawUserInfo() != null
            || uri.getRawQuery() != null || uri.getRawFragment() != null
            || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))
            || uri.getPort() < -1 || uri.getPort() == 0 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("Invalid server origin");
        }
        scheme = scheme.toLowerCase(java.util.Locale.ROOT);
        int port = uri.getPort();
        if (("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80)) port = -1;
        return new URI(scheme, null, uri.getHost().toLowerCase(java.util.Locale.ROOT), port, null, null, null).toASCIIString();
    }

    private boolean trusted(Uri uri) {
        if (uri == null) return false;
        Uri expected = Uri.parse(serverOrigin);
        return expected.getScheme().equalsIgnoreCase(uri.getScheme())
            && expected.getHost().equalsIgnoreCase(uri.getHost())
            && effectivePort(expected) == effectivePort(uri);
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() != -1 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showServer() {
        disposeWebView();
        root.removeAllViews();
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.addView(label("77 ERP", 18), new LinearLayout.LayoutParams(0, -2, 1));
        toolbar.addView(button("刷新", () -> {
            if (webView != null) webView.loadUrl(serverOrigin + "/");
        }));
        toolbar.addView(button("服务器", () -> new AlertDialog.Builder(this)
            .setTitle("服务器设置").setMessage("打开设置将关闭当前页面，请先保存未提交的单据。")
            .setNegativeButton("取消", null).setPositiveButton("打开设置", (dialog, which) -> showConnection()).show()));
        root.addView(toolbar);
        status = label("正在连接服务器…", 14);
        root.addView(status);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            status.setText("请先更新 Android System WebView，再打开 App 使用扫码和文件保存。");
            webView.destroy();
            webView = null;
            return;
        }
        WebViewCompat.addWebMessageListener(webView, "ERPAndroid", Collections.singleton(serverOrigin),
            (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !trusted(sourceOrigin) || !trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return;
                handleMessage(message.getData(), reply);
            });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception e) { Toast.makeText(MainActivity.this, "未找到可用浏览器。", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                status.setText("正在连接服务器…");
                status.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if ("正在连接服务器…".contentEquals(status.getText())) status.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) connectionFailed();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) connectionFailed();
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                status.setText("服务器证书无效，请修复证书后重试。");
                status.setVisibility(View.VISIBLE);
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        webView.loadUrl(serverOrigin + "/");
    }

    private void connectionFailed() {
        status.setText("无法连接服务器，请检查网络和服务器地址，再点击刷新。");
        status.setVisibility(View.VISIBLE);
    }

    private void handleMessage(String raw, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            if (raw == null || raw.length() > 12 * 1024 * 1024) throw new IllegalArgumentException();
            JSONObject message = new JSONObject(raw);
            id = message.getString("id");
            if (id.length() > 100) throw new IllegalArgumentException();
            if (pending != null) { respond(new Pending(id, reply), null, "请先完成当前扫码或文件保存。"); return; }
            String action = message.getString("action");
            if ("scan".equals(action)) {
                pending = new Pending(id, reply);
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    scanner.launch(new Intent(this, ScannerActivity.class));
                } else cameraPermission.launch(Manifest.permission.CAMERA);
            } else if ("save".equals(action)) {
                String mime = message.getString("mime");
                if (!mime.equals("text/csv") && !mime.equals("image/svg+xml") && !mime.equals("text/plain")) throw new IllegalArgumentException();
                byte[] content = message.getString("text").getBytes(StandardCharsets.UTF_8);
                if (content.length > 10 * 1024 * 1024) { respond(new Pending(id, reply), null, "文件过大，请减少导出范围。"); return; }
                String filename = message.getString("filename").replaceAll("[\\\\/\\p{Cntrl}]", "_");
                if (filename.trim().isEmpty() || filename.length() > 180) throw new IllegalArgumentException();
                pending = new Pending(id, reply);
                pendingFile = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, filename);
                saveDocument.launch(intent);
            } else respond(new Pending(id, reply), null, "不支持的手机操作。");
        } catch (Exception e) {
            if (pending != null && pending.id().equals(id)) {
                pendingFile = null;
                finishRequest(null, "无法执行操作，请重试。");
            } else respond(new Pending(id, reply), null, "无法执行操作，请重试。");
        }
    }

    private void finishRequest(String value, String error) {
        Pending request = pending;
        pending = null;
        if (request != null) respond(request, value, error);
    }

    private void respond(Pending request, String value, String error) {
        try {
            JSONObject response = new JSONObject().put("id", request.id());
            if (error != null) response.put("error", error);
            else response.put("result", value == null ? JSONObject.NULL : value);
            request.reply().postMessage(response.toString());
        } catch (Exception ignored) { /* The requesting document may have been closed. */ }
    }

    @Override protected void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
    }

    @Override protected void onDestroy() {
        disposeWebView();
        fileWriter.shutdown();
        super.onDestroy();
    }
}
