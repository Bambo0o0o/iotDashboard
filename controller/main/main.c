// ====================================================
// File: controller/main/main.c
// MERN ESP32-S3 Dashboard Controller
// Features: SSL HTTPS POST, NTP Time Sync, Dynamic Send Interval,
//           Debounce & Raw Noise Sampling, RGB LED Status Indicator
// ====================================================
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_sntp.h"
#include "led_strip.h"

// Pointer อ้างอิงไฟล์ Certificate GTS Root R4 ที่ฝังผ่าน CMakeLists.txt
extern const char gts_root_r4_pem_start[] asm("_binary_gts_root_r4_pem_start");
extern const char gts_root_r4_pem_end[]   asm("_binary_gts_root_r4_pem_end");

// ====================================================
// Configuration & Pin Definitions
// ====================================================
#define WIFI_SSID       "Tsai-wu_2.4GHz"                                    // SSID WiFi
#define WIFI_PASS       "0888799533"                                        // Password WiFi
#define SERVER_HTTP_URL "https://iotdashboard-mq5d.onrender.com/api/sensor" // Endpoint API

#define PIN_POT_ADC     ADC_CHANNEL_0    // GPIO1 (ADC1_CH0) - Potentiometer Signal
#define PIN_LDR_ADC     ADC_CHANNEL_1    // GPIO2 (ADC1_CH1) - LDR Signal
#define PIN_BTN_1       GPIO_NUM_4       // Push Button 1
#define PIN_BTN_2       GPIO_NUM_5       // Push Button 2
#define LED_RGB_GPIO    GPIO_NUM_48      // RGB LED บนบอร์ด ESP32-S3 (ข้อ 19)

#define DEBOUNCE_DELAY_MS 50
#define VREF              3.3f
#define ADC_RESOLUTION    4095.0f
#define FIXED_RESISTOR    10000.0f       // Resistor 10k Ohm

static const char *TAG = "ESP32_WIFI_SYSTEM";

static led_strip_handle_t led_strip;
static adc_oneshot_unit_handle_t adc1_handle;
static SemaphoreHandle_t data_mutex;

static volatile bool is_wifi_connected = false;
static volatile bool is_time_synced = false;

// ตัวแปรตั้งค่าช่วงเวลาการส่งข้อมูล (ข้อ 11)
// 0 = Realtime, 10000 = 10 วินาที, 300000 = 5 นาที, 3600000 = 1 ชั่วโมง
static volatile uint32_t send_interval_ms = 0; 
static uint32_t last_send_time = 0;

typedef struct {
    gpio_num_t pin;
    int raw_state;
    int debounced_state;
    int last_raw_state;
    TickType_t last_debounce_time;
} Button_t;

static Button_t btn1 = {PIN_BTN_1, 1, 1, 1, 0};
static Button_t btn2 = {PIN_BTN_2, 1, 1, 1, 0};

static float current_voltage = 0.0f;
static float current_resistance = 0.0f;
static float current_ampere = 0.0f;
static int current_ldr = 0;

// ====================================================
// RGB LED Status Driver (ข้อ 19)
// ====================================================
void set_rgb_color(uint8_t red, uint8_t green, uint8_t blue) {
    if (led_strip) {
        led_strip_set_pixel(led_strip, 0, red, green, blue);
        led_strip_refresh(led_strip);
    }
}

// ฟังก์ชันแสดงสถานะกระพริบสีเหลืองระหว่างส่งข้อมูล (ข้อ 19 - ข้อ 2)
void blink_yellow(int duration_ms) {
    int toggle_count = duration_ms / 100;
    for (int i = 0; i < toggle_count; i++) {
        if (i % 2 == 0) set_rgb_color(255, 180, 0); // สีเหลือง
        else set_rgb_color(0, 0, 0);                 // ปิดไฟ
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// ====================================================
// SNTP Time Synchronization
// ====================================================
void obtain_time(void) {
    ESP_LOGI(TAG, "Initializing SNTP...");
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    time_t now = 0;
    struct tm timeinfo = { 0 };
    int retry = 0;
    const int retry_count = 15;

    while (sntp_get_sync_status() == SNTP_SYNC_STATUS_RESET && ++retry <= retry_count) {
        ESP_LOGI(TAG, "Waiting for system time to be set... (%d/%d)", retry, retry_count);
        vTaskDelay(pdMS_TO_TICKS(2000));
    }

    time(&now);
    localtime_r(&now, &timeinfo);
    if (timeinfo.tm_year > (1970 - 1900)) {
        is_time_synced = true;
        ESP_LOGI(TAG, "Time synced successfully! Current time: %s", asctime(&timeinfo));
    } else {
        ESP_LOGE(TAG, "Failed to sync time from NTP server.");
    }
}

// ====================================================
// WiFi Handlers
// ====================================================
static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        is_wifi_connected = false;
        is_time_synced = false;
        ESP_LOGW(TAG, "WiFi Disconnected, Reconnecting...");
        set_rgb_color(255, 0, 0); // ข้อ 19 - ข้อ 1: สีแดงยังเชื่อมต่อไม่สำเร็จ
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "WiFi Connected! IP: " IPSTR, IP2STR(&event->ip_info.ip));
        is_wifi_connected = true;
        obtain_time();
    }
}

void wifi_init_sta(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
}

// ====================================================
// HTTP Client & Data Transmission
// ====================================================
bool send_sensor_data_http(const char *json_payload) {
    char response_buffer[128] = {0};

    esp_http_client_config_t config = {
        .url = SERVER_HTTP_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 15000,
        .user_data = response_buffer,
        .cert_pem = gts_root_r4_pem_start,
        .transport_type = HTTP_TRANSPORT_OVER_SSL,
    };
    
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, json_payload, strlen(json_payload));

    esp_err_t err = esp_http_client_perform(client);
    bool success = false;

    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        if (status_code == 200 || status_code == 201) {
            ESP_LOGI(TAG, "HTTP POST Success, Status: %d", status_code);
            success = true;
        } else {
            ESP_LOGE(TAG, "HTTP POST Server Error, Status: %d", status_code);
        }
    } else {
        ESP_LOGE(TAG, "HTTP POST Failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
    return success;
}

// ====================================================
// Tasks Configuration
// ====================================================
void update_button(Button_t *btn) {
    int current_read = gpio_get_level(btn->pin);
    TickType_t now = xTaskGetTickCount();

    if (current_read != btn->last_raw_state) {
        btn->last_debounce_time = now;
        btn->last_raw_state = current_read;
    }

    if ((now - btn->last_debounce_time) > pdMS_TO_TICKS(DEBOUNCE_DELAY_MS)) {
        if (current_read != btn->debounced_state) {
            btn->debounced_state = current_read;
        }
    }
    btn->raw_state = current_read;
}

void sensor_task(void *pvParameters) {
    while (1) {
        int pot_sum = 0, ldr_sum = 0;
        for (int i = 0; i < 10; i++) {
            int p_val = 0, l_val = 0;
            adc_oneshot_read(adc1_handle, PIN_POT_ADC, &p_val);
            adc_oneshot_read(adc1_handle, PIN_LDR_ADC, &l_val);
            pot_sum += p_val;
            ldr_sum += l_val;
            vTaskDelay(pdMS_TO_TICKS(1));
        }
        int raw_pot = pot_sum / 10;
        int raw_ldr = ldr_sum / 10;

        float voltage = ((float)raw_pot / ADC_RESOLUTION) * VREF;
        float resistance = 0.0f;
        float current = 0.0f;

        if (voltage > 0.01f && (VREF - voltage) > 0.01f) {
            resistance = (voltage * FIXED_RESISTOR) / (VREF - voltage);
            current = ((VREF - voltage) / FIXED_RESISTOR) * 1000.0f; // mA
        }

        if (xSemaphoreTake(data_mutex, portMAX_DELAY)) {
            current_voltage = voltage;
            current_resistance = resistance;
            current_ampere = current;
            current_ldr = raw_ldr;
            xSemaphoreGive(data_mutex);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void button_task(void *pvParameters) {
    while (1) {
        update_button(&btn1);
        update_button(&btn2);
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void telemetry_task(void *pvParameters) {
    char json_payload[256];

    while (1) {
        uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;

        // ข้อ 19 - ข้อ 1: ถ้ายังไม่ต่อ Wi-Fi หรือยังไม่ซิงค์เวลา ให้ขึ้นไฟสีแดง
        if (!is_wifi_connected || !is_time_synced) {
            set_rgb_color(255, 0, 0); 
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        // ตรวจสอบเงื่อนไขตามช่วงเวลาส่งข้อมูล (ข้อ 11)
        if (send_interval_ms == 0 || (now - last_send_time >= send_interval_ms)) {
            
            // ข้อ 19 - ข้อ 2: ไฟสีเหลืองกระพริบขณะส่งข้อมูล
            blink_yellow(300);

            if (xSemaphoreTake(data_mutex, portMAX_DELAY)) {
                // ข้อ 6: ส่งทั้ง Raw (มี Noise) และ Debounced state
                snprintf(json_payload, sizeof(json_payload),
                         "{\"voltage\":%.2f,\"resistance\":%.2f,\"current\":%.2f,\"ldr\":%d,"
                         "\"btn1Raw\":%d,\"btn1Debounced\":%d,\"btn2Raw\":%d,\"btn2Debounced\":%d}",
                         current_voltage, current_resistance, current_ampere, current_ldr,
                         !btn1.raw_state, !btn1.debounced_state,
                         !btn2.raw_state, !btn2.debounced_state);
                xSemaphoreGive(data_mutex);
            }

            printf("Payload: %s\n", json_payload);
            
            bool success = send_sensor_data_http(json_payload);
            if (success) {
                // ข้อ 19 - ข้อ 3: แสดงสีเขียวเมื่อส่งสำเร็จ
                set_rgb_color(0, 255, 0); 
                vTaskDelay(pdMS_TO_TICKS(500)); // ค้างสีเขียว 0.5 วินาที
            } else {
                // ข้อ 19 - ข้อ 1: ส่งล้มเหลวเปลี่ยนเป็นสีแดง
                set_rgb_color(255, 0, 0);
                vTaskDelay(pdMS_TO_TICKS(1000));
            }

            last_send_time = now;

        } else {
            // ข้อ 19 - ข้อ 4: สีน้ำเงินคือสถานะรอส่งข้อมูลตามช่วงเวลา
            set_rgb_color(0, 0, 255); 
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    data_mutex = xSemaphoreCreateMutex();

    // Config RGB LED
    led_strip_config_t strip_config = { .strip_gpio_num = LED_RGB_GPIO, .max_leds = 1 };
    led_strip_rmt_config_t rmt_config = { .resolution_hz = 10 * 1000 * 1000 };
    ESP_ERROR_CHECK(led_strip_new_rmt_device(&strip_config, &rmt_config, &led_strip));
    set_rgb_color(255, 0, 0); // สีแดงเริ่มต้น

    // Config Push Buttons
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_BTN_1) | (1ULL << PIN_BTN_2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);

    // Config ADC1
    adc_oneshot_unit_init_cfg_t init_config1 = { .unit_id = ADC_UNIT_1 };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_config1, &adc1_handle));

    adc_oneshot_chan_cfg_t config = {
        .bitwidth = ADC_BITWIDTH_DEFAULT,
        .atten = ADC_ATTEN_DB_12,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, PIN_POT_ADC, &config));
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, PIN_LDR_ADC, &config));

    wifi_init_sta();

    xTaskCreate(sensor_task, "sensor_task", 3072, NULL, 5, NULL);
    xTaskCreate(button_task, "button_task", 2048, NULL, 5, NULL);
    xTaskCreate(telemetry_task, "telemetry_task", 8192, NULL, 4, NULL);
}