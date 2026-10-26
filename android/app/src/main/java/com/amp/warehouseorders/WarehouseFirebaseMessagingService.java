package com.amp.warehouseorders;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class WarehouseFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "warehouse_orders_v5_custom_sound";

    @Override
    public void onNewToken(@NonNull String token) {
        getSharedPreferences("warehouse_push", MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .apply();
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String title = value(data, "title", "Заказы · Склад");
        String body = value(data, "body", "Новое изменение в заказе.");
        String link = value(data, "link", "https://hlebish.github.io/warehouse_orders/");

        // Use an explicit Activity intent: ACTION_VIEW cannot resolve to MainActivity
        // because the app intentionally does not register a browser/deep-link filter.
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction("com.amp.warehouseorders.OPEN_NOTIFICATION");
        intent.putExtra("notification_link", link);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

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
    }

    private String value(Map<String, String> data, String key, String fallback) {
        String value = data.get(key);
        return value == null || value.isEmpty() ? fallback : value;
    }
}
