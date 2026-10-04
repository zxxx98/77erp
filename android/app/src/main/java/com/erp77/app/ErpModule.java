package com.erp77.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.Cookie;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Native networking and camera only. No HTML renderer or JS-visible session token. */
public class ErpModule extends ReactContextBaseJavaModule {
    private static final int SCAN_REQUEST = 7701;
    private static final String KEY_ALIAS = "77erp.native.session";
    private final SharedPreferences preferences;
    // Serialize requests with workspace changes, login and logout.
    private final ExecutorService requests = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).build();
    private Promise scanPromise;

    public ErpModule(ReactApplicationContext context) {
        super(context);
        preferences = context.getSharedPreferences("native_client", Context.MODE_PRIVATE);
        context.addActivityEventListener(new BaseActivityEventListener() {
            @Override public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
                if (requestCode != SCAN_REQUEST || scanPromise == null) return;
                Promise promise = scanPromise;
                scanPromise = null;
                if (resultCode == Activity.RESULT_OK && data != null) promise.resolve(data.getStringExtra("barcode"));
                else if (data != null && data.hasExtra("error")) promise.reject("CAMERA", data.getStringExtra("error"));
                else promise.resolve(null);
            }
        });
    }
    @Override public String getName() { return "ErpNative"; }

    @ReactMethod public void getVersionCode(Promise promise) {
        try {
            promise.resolve((double) getReactApplicationContext().getPackageManager()
                .getPackageInfo(getReactApplicationContext().getPackageName(), 0).getLongVersionCode());
        } catch (Exception e) {
            promise.reject("VERSION", "无法读取当前应用版本。", e);
        }
    }

    private String server() {
        // Migrate the address from 1.0; the user signs in again with a new native session.
        String previous = getReactApplicationContext().getSharedPreferences("MainActivity", Context.MODE_PRIVATE).getString("server", "");
        return preferences.getString("server", previous);
    }
    @ReactMethod public void getServer(Promise promise) {
        requests.execute(() -> promise.resolve(server()));
    }
    @ReactMethod public void setServer(String address, Promise promise) {
        requests.execute(() -> {
            try {
                if (!address.trim().matches("(?i)^https?://.*")) throw new IllegalArgumentException();
                HttpUrl url = HttpUrl.get(address.trim());
                if (!url.username().isEmpty() || !url.password().isEmpty() || url.query() != null
                    || url.fragment() != null || !url.encodedPath().equals("/")) throw new IllegalArgumentException();
                String origin = url.toString().replaceAll("/$", "");
                SharedPreferences.Editor edit = preferences.edit().putString("server", origin);
                if (!origin.equals(server())) edit.remove("session");
                if (!edit.commit()) throw new java.io.IOException("Cannot save preferences");
                promise.resolve(origin);
            } catch (Exception e) {
                promise.reject("SERVER", "请输入完整的 HTTP 或 HTTPS 服务器根地址，不含 /api、账号或参数。");
            }
        });
    }

    private SecretKey sessionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
    }
    private String sessionCookie(String origin) {
        try {
            String saved = preferences.getString("session", null);
            if (saved == null) return null;
            JSONObject encrypted = new JSONObject(saved);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, sessionKey(), new GCMParameterSpec(128, Base64.decode(encrypted.getString("iv"), Base64.NO_WRAP)));
            JSONObject session = new JSONObject(new String(cipher.doFinal(Base64.decode(encrypted.getString("value"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
            if (session.getString("origin").equals(origin) && session.getLong("expires") > System.currentTimeMillis()) return session.getString("cookie");
        } catch (Exception ignored) { /* An invalidated key requires a fresh login. */ }
        preferences.edit().remove("session").commit();
        return null;
    }
    private void saveSession(String origin, Cookie cookie) throws Exception {
        if (cookie.expiresAt() <= System.currentTimeMillis() || cookie.value().isEmpty()) {
            preferences.edit().remove("session").commit();
            return;
        }
        String plain = new JSONObject().put("origin", origin).put("expires", cookie.expiresAt())
            .put("cookie", cookie.name() + "=" + cookie.value()).toString();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, sessionKey());
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        String saved = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("value", Base64.encodeToString(encrypted, Base64.NO_WRAP)).toString();
        if (!preferences.edit().putString("session", saved).commit()) throw new java.io.IOException("Cannot persist session");
    }

    @ReactMethod public void request(String path, String method, String body, Promise promise) {
        requests.execute(() -> {
            try {
                String origin = server();
                HttpUrl base = HttpUrl.get(origin);
                HttpUrl url = base.resolve(path);
                if (!path.startsWith("/api/") || url == null || !url.scheme().equals(base.scheme())
                    || !url.host().equals(base.host()) || url.port() != base.port() || !url.encodedPath().startsWith("/api/")
                    || !(method.equals("GET") || method.equals("POST") || method.equals("PUT"))) {
                    promise.reject("REQUEST", "无效的服务器请求。"); return;
                }
                Request.Builder builder = new Request.Builder().url(url).header("Accept", "application/json");
                String cookie = sessionCookie(origin);
                if (cookie != null) builder.header("Cookie", cookie);
                if (!method.equals("GET")) builder.method(method, RequestBody.create(MediaType.get("application/json; charset=utf-8"), body));
                try (Response response = http.newCall(builder.build()).execute()) {
                    for (Cookie received : Cookie.parseAll(url, response.headers())) {
                        if (received.name().equals("77erp_session") && received.matches(url)) saveSession(origin, received);
                    }
                    if (response.code() == 401 || path.equals("/api/auth/logout")) preferences.edit().remove("session").commit();
                    WritableMap result = Arguments.createMap();
                    result.putInt("status", response.code());
                    result.putString("body", response.body() == null ? "{}" : response.body().string());
                    promise.resolve(result);
                }
            } catch (Exception e) {
                promise.reject("NETWORK", "无法连接服务器，请检查网络、地址或 HTTPS 证书。");
            }
        });
    }
    @ReactMethod public void clearSession(Promise promise) {
        requests.execute(() -> { preferences.edit().remove("session").commit(); promise.resolve(null); });
    }
    @ReactMethod public void scan(Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) { promise.reject("CAMERA", "请返回 App 后重试。"); return; }
        activity.runOnUiThread(() -> {
            if (scanPromise != null) { promise.reject("CAMERA", "摄像头正在使用中。"); return; }
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("CAMERA", "请先允许访问摄像头。"); return;
            }
            scanPromise = promise;
            try { activity.startActivityForResult(new Intent(activity, ScannerActivity.class), SCAN_REQUEST); }
            catch (Exception e) { scanPromise = null; promise.reject("CAMERA", "无法打开摄像头，请重试。"); }
        });
    }
    @Override public void invalidate() {
        requests.shutdown();
        http.dispatcher().cancelAll();
        super.invalidate();
    }
}
