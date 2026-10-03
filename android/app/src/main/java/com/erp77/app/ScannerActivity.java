package com.erp77.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.common.InputImage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ScannerActivity extends ComponentActivity {
    private final ExecutorService analyzerExecutor = Executors.newSingleThreadExecutor();
    private final BarcodeScanner scanner = BarcodeScanning.getClient();
    private ProcessCameraProvider cameraProvider;
    private ImageAnalysis analysis;
    private boolean completed;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        PreviewView previewView = new PreviewView(this);
        root.addView(previewView, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(24, 24, 24, 32);
        controls.setBackgroundColor(0xBB17243C);
        TextView instruction = new TextView(this);
        instruction.setText("将商品条码置于取景框内\n识别后自动返回，确认单据后才会变更库存。");
        instruction.setTextColor(Color.WHITE);
        instruction.setTextSize(17);
        instruction.setGravity(Gravity.CENTER);
        controls.addView(instruction);
        Button cancel = new Button(this);
        cancel.setText("取消扫码");
        cancel.setOnClickListener(v -> finish());
        controls.addView(cancel);
        root.addView(controls, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        setContentView(root);
        startCamera(previewView);
    }

    @androidx.annotation.OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void startCamera(PreviewView previewView) {
        var future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                cameraProvider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                analysis = new ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                analysis.setAnalyzer(analyzerExecutor, proxy -> {
                    var mediaImage = proxy.getImage();
                    if (mediaImage == null) { proxy.close(); return; }
                    InputImage image = InputImage.fromMediaImage(mediaImage, proxy.getImageInfo().getRotationDegrees());
                    try {
                        scanner.process(image)
                            .addOnSuccessListener(barcodes -> {
                                if (completed || isFinishing() || isDestroyed()) return;
                                for (var barcode : barcodes) {
                                    String value = barcode.getRawValue();
                                    if (value != null && !value.trim().isEmpty()) {
                                        completed = true;
                                        analysis.clearAnalyzer();
                                        setResult(RESULT_OK, new Intent().putExtra("barcode", value));
                                        finish();
                                        break;
                                    }
                                }
                            })
                            .addOnFailureListener(error -> fail("条码识别失败，请重新打开摄像头。"))
                            .addOnCompleteListener(result -> proxy.close());
                    } catch (Exception e) {
                        proxy.close();
                        runOnUiThread(() -> fail("无法启动条码识别，请重试。"));
                    }
                });
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
            } catch (Exception e) {
                fail("无法访问摄像头，请检查摄像头权限或手动输入条码。");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void fail(String message) {
        if (completed || isFinishing() || isDestroyed()) return;
        completed = true;
        setResult(RESULT_CANCELED, new Intent().putExtra("error", message));
        finish();
    }

    @Override protected void onDestroy() {
        if (analysis != null) analysis.clearAnalyzer();
        if (cameraProvider != null) cameraProvider.unbindAll();
        analyzerExecutor.shutdown();
        scanner.close();
        super.onDestroy();
    }
}
