let rechapcha;
grecaptcha.ready(function() {
    grecaptcha.execute('6LdiCBopAAAAAMfpS2IR78w0QeCjrEmWeJTgLMUf', {action: 'homepage'}).then(function(token) {
        rechapcha = token;
    });
});