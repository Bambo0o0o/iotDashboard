idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    EMBED_TXTFILES "gts_root_r4.pem"
    REQUIRES 
        driver 
        esp_driver_gpio 
        esp_adc 
        freertos 
        esp_eth 
        esp_event 
        esp_netif 
        led_strip 
        esp_driver_uart 
        esp_wifi 
        nvs_flash 
        esp_http_client 
        mbedtls
)