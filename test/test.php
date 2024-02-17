<?php

echo "<p>this works</p>";
echo "<p>" . getenv("APP_DOMAIN") . "</p>";

echo "<p>PHP Version:" . PHP_VERSION . "</p>";

phpinfo();

?>
