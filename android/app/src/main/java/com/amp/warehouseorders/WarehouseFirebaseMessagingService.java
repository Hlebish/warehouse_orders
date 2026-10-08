package com.amp.warehouseorders;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class WarehouseFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "warehouse_orders";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String title = value(data, "title", "Заказы · Склад");
        String body = value(data, "body", "Новое изменение в заказе.");
        String link = value(data, "link", "https://hlebish.github.io/warehouse_orders/");

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
        intent.setPackage(getPackageName());

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            Math.abs(link.hashCode()),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(value(data, "eventId", String.valueOf(System.currentTimeMillis())).hashCode(), builder.build());
        playWarehouseTone();
    }

    private void playWarehouseTone() {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 180);
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 180);
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(tone::release, 220);
            }, 210);
        } catch (Exception ignored) {
        }
    }

    private String value(Map<String, String> data, String key, String fallback) {
        String value = data.get(key);
        return value == null || value.isEmpty() ? fallback : value;
    }
}
