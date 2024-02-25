#!/bin/bash

set -eu

mkdir -p /run/apache2 /run/lumos /run/lumos/sessions /app/data/apache

readonly ARTISAN="sudo -E -u www-data php /app/code/artisan"

if [[ ! -f /app/data/.cr ]]; then
    echo "=> First run"
    mkdir -p /app/data/storage
    cp -R /app/code/storage.template/* /app/data/storage
    cp /app/code/.env.prod-cloudron /app/data/env

    chown -R www-data:www-data /run/lumos /app/data

    echo "=> Generating app key"
    $ARTISAN key:generate --force --no-interaction

    echo "=> Run migrations and seed database"
    $ARTISAN lumos:install
    # $ARTISAN migrate --seed --force

    # echo "=> Create the access tokens required for the API"
    # $ARTISAN passport:keys --force
    # $ARTISAN passport:client --personal --no-interaction

    touch /app/data/.cr
else
    echo "=> Existing installation. Running migration script"
    chown -R www-data:www-data /run/apache2 /run/lumos /app/data
    # $ARTISAN lumos:update --force
fi



if [[ ! -f /app/data/php.ini ]]; then
    echo -e "; Add custom PHP configuration in this file\n; Settings here are merged with the package's built-in php.ini; Restart the app for any changes to take effect\n\nsession.save_path = "/run/lumos/sessions"" > /app/data/php.ini
fi

[[ ! -f /app/data/apache/mpm_prefork.conf ]] && cp /app/code/apache/mpm_prefork.conf /app/data/apache/mpm_prefork.conf
[[ ! -f /app/data/apache/app.conf ]] && cp /app/code/apache/app.conf /app/data/apache/app.conf
[[ ! -f /app/data/PHP_VERSION ]] && echo -e "; Set the desired PHP version in this file\n; Restart app for changes to take effect\nPHP_VERSION=8.1" > /app/data/PHP_VERSION

readonly php_version=$(sed -ne 's/^PHP_VERSION=\(.*\)$/\1/p' /app/data/PHP_VERSION)
echo "==> PHP version set to ${php_version}"
ln -sf /etc/apache2/mods-available/php${php_version}.conf /run/apache2/php.conf
ln -sf /etc/apache2/mods-available/php${php_version}.load /run/apache2/php.load


# source it so that env vars are persisted
echo "==> Source custom startup script"
[[ -f /app/data/run.sh ]] && source /app/data/run.sh

[[ -f /app/data/crontab ]] && echo -e "\n\033[0;31mWARNING: crontab support has been removed. Please move cron tasks to the cron section of the app. See https://docs.cloudron.io/apps/#cron for more information.\033[0m\n"

# phpMyAdmin auth file
if [[ ! -f /app/data/.phpmyadminauth ]]; then
    echo "==> Generating phpMyAdmin authentication file"
    PASSWORD=`pwgen -1 16`
    htpasswd -cb /app/data/.phpmyadminauth admin "${PASSWORD}"
    sed -e "s,PASSWORD,${PASSWORD}," /app/code/phpmyadmin_login.template > /app/data/phpmyadmin_login.txt
fi

echo "==> Creating credentials.txt"
sed -e "s,\bMYSQL_HOST\b,${CLOUDRON_MYSQL_HOST}," \
    -e "s,\bMYSQL_PORT\b,${CLOUDRON_MYSQL_PORT}," \
    -e "s,\bMYSQL_USERNAME\b,${CLOUDRON_MYSQL_USERNAME}," \
    -e "s,\bMYSQL_PASSWORD\b,${CLOUDRON_MYSQL_PASSWORD}," \
    -e "s,\bMYSQL_DATABASE\b,${CLOUDRON_MYSQL_DATABASE}," \
    -e "s,\bMYSQL_URL\b,${CLOUDRON_MYSQL_URL}," \
    -e "s,\bMAIL_SMTP_SERVER\b,${CLOUDRON_MAIL_SMTP_SERVER}," \
    -e "s,\bMAIL_SMTP_PORT\b,${CLOUDRON_MAIL_SMTP_PORT}," \
    -e "s,\bMAIL_SMTPS_PORT\b,${CLOUDRON_MAIL_SMTPS_PORT}," \
    -e "s,\bMAIL_SMTP_USERNAME\b,${CLOUDRON_MAIL_SMTP_USERNAME}," \
    -e "s,\bMAIL_SMTP_PASSWORD\b,${CLOUDRON_MAIL_SMTP_PASSWORD}," \
    -e "s,\bMAIL_FROM\b,${CLOUDRON_MAIL_FROM}," \
    -e "s,\bMAIL_DOMAIN\b,${CLOUDRON_MAIL_DOMAIN}," \
    -e "s,\bREDIS_HOST\b,${CLOUDRON_REDIS_HOST:-NA}," \
    -e "s,\bREDIS_PORT\b,${CLOUDRON_REDIS_PORT:-NA}," \
    -e "s,\bREDIS_PASSWORD\b,${CLOUDRON_REDIS_PASSWORD:-NA}," \
    -e "s,\bREDIS_URL\b,${CLOUDRON_REDIS_URL:-NA}," \
    /app/code/credentials.template > /app/data/credentials.txt
    
# sessions, logs and cache
[[ -d /app/data/storage/framework/sessions ]] && rm -rf /app/data/storage/framework/sessions
ln -sf /run/lumos/sessions /app/data/storage/framework/sessions
# rm -rf /app/data/storage/framework/cache && ln -s /run/lumos/framework-cache /app/data/storage/framework/cache
# rm -rf /app/data/storage/logs && ln -s /run/lumos/logs /app/data/storage/logs


chown -R www-data:www-data /app/data /run/apache2 /run/lumos /tmp

echo "=> Starting Apache"
APACHE_CONFDIR="" source /etc/apache2/envvars
rm -f "${APACHE_PID_FILE}"
exec /usr/sbin/apache2 -DFOREGROUND


