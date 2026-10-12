package com.erp77.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Downloads independently of ERP requests; only shares a verified APK with the installer. */
final class AppUpdater {
    private static final int INSTALL_PERMISSION_REQUEST = 7703;
    private static final long MAX_APK_SIZE = 250L * 1024 * 1024;
    private static final Pattern RELEASE_URL = Pattern.compile(
        "https://github\\.com/zxxx98/77erp/releases/download/v((0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*))/77ERP-\\1-arm64\\.apk");
    private final ReactApplicationContext context;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.MINUTES)
        .followRedirects(true).followSslRedirects(false).build();
    private final AtomicBoolean busy = new AtomicBoolean();
    private Promise pending;
    private File apk;

    AppUpdater(ReactApplicationContext context) { this.context = context; }

    void install(String url, Activity activity, Promise promise) {
        if (activity == null) { promise.reject("UPDATE", "请返回应用后重试。"); return; }
        Matcher match = RELEASE_URL.matcher(url);
        if (!match.matches()) { promise.reject("UPDATE", "无效的 GitHub 安装包地址。"); return; }
        final long expectedCode;
        try {
            long major = Long.parseLong(match.group(2));
            long minor = Long.parseLong(match.group(3));
            long patch = Long.parseLong(match.group(4));
            if (major > 2099 || minor > 999 || patch > 999) throw new IllegalArgumentException();
            expectedCode = major * 1000000 + minor * 1000 + patch;
        } catch (RuntimeException e) { promise.reject("UPDATE", "无效的更新版本。"); return; }
        if (!busy.compareAndSet(false, true)) { promise.reject("UPDATE", "更新正在进行中，请稍候。"); return; }
        activity.runOnUiThread(() -> {
            pending = promise;
            downloads.execute(() -> download(url, expectedCode));
        });
    }

    private void download(String url, long expectedCode) {
        File target = null;
        try {
            File directory = new File(context.getCacheDir(), "updates");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
            target = new File(directory, "latest.apk");
            try (Response response = http.newCall(new Request.Builder().url(url).build()).execute()) {
                if (!response.isSuccessful() || response.body() == null) throw new IOException();
                long length = response.body().contentLength();
                if (length > MAX_APK_SIZE) throw new IOException();
                long received = 0;
                try (InputStream input = response.body().byteStream(); FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        received += count;
                        if (received > MAX_APK_SIZE || Thread.currentThread().isInterrupted()) throw new IOException();
                        output.write(buffer, 0, count);
                    }
                }
                if (received == 0 || (length >= 0 && received != length)) throw new IOException();
            }
            PackageManager manager = context.getPackageManager();
            PackageInfo archive = manager.getPackageArchiveInfo(target.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
            PackageInfo installed = manager.getPackageInfo(context.getPackageName(), 0);
            if (archive == null || !context.getPackageName().equals(archive.packageName)
                || archive.getLongVersionCode() != expectedCode || expectedCode <= installed.getLongVersionCode()
                || archive.signingInfo == null) throw new IOException();
            Signature[] signers = archive.signingInfo.getApkContentsSigners();
            if (signers.length == 0) throw new IOException();
            for (Signature signer : signers) {
                if (!manager.hasSigningCertificate(context.getPackageName(), signer.toByteArray(), PackageManager.CERT_INPUT_RAW_X509))
                    throw new IOException();
            }
            File verified = target;
            context.runOnUiQueueThread(() -> {
                apk = verified;
                openInstaller(true);
            });
        } catch (Exception e) {
            if (target != null) target.delete();
            context.runOnUiQueueThread(() -> fail("下载安装包失败，请检查网络、存储空间以及发布包的版本和签名后重试。"));
        }
    }

    private void openInstaller(boolean requestPermission) {
        if (pending == null) return;
        Activity activity = context.getCurrentActivity();
        if (activity == null) { fail("请返回应用并重新点击立即更新。"); return; }
        try {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                if (!requestPermission) { fail("未允许安装应用，请开启权限后重新点击立即更新。"); return; }
                activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())), INSTALL_PERMISSION_REQUEST);
                return;
            }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".updates", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            pending.resolve(null);
            pending = null;
            busy.set(false);
        } catch (Exception e) { fail("无法打开系统安装界面，请稍后重试。"); }
    }

    boolean onActivityResult(int requestCode) {
        if (requestCode != INSTALL_PERMISSION_REQUEST) return false;
        openInstaller(false);
        return true;
    }

    private void fail(String message) {
        if (pending != null) pending.reject("UPDATE", message);
        pending = null;
        busy.set(false);
    }

    void close() {
        http.dispatcher().cancelAll();
        downloads.shutdownNow();
        context.runOnUiQueueThread(() -> fail("更新已中断，请重新打开应用重试。"));
    }
}
