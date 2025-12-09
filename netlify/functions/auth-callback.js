// netlify/functions/auth-callback.js
const axios = require('axios');

// Lee las variables de entorno de Netlify
const { 
    AUTH0_CLIENT_ID, 
    AUTH0_CLIENT_SECRET, 
    AUTH0_DOMAIN 
} = process.env;

exports.handler = async (event, context) => {
    // 1. Obtener el código de autorización de la URL de retorno
    const { code } = event.queryStringParameters;
    
    // Si no hay código, algo salió mal
    if (!code) {
        return {
            statusCode: 400,
            body: 'Error: No authorization code provided.'
        };
    }

    const redirectUri = 'https://azor-calidad.netlify.app/'; // Debe coincidir con el valor FIJO

    try {
        // 2. Intercambiar el código por los tokens (ID Token y Access Token)
        const tokenResponse = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
            grant_type: 'authorization_code',
            client_id: AUTH0_CLIENT_ID,
            client_secret: AUTH0_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const { id_token, access_token } = tokenResponse.data;

        // 3. Redireccionar al cliente, estableciendo una cookie o token de sesión
        // En un SPA, esto sería establecer cookies y redirigir al /index.html
        return {
            statusCode: 302,
            headers: {
                // Aquí va la lógica para manejar el token de manera segura (ej. cookies)
                // Para una prueba simple, redirigimos al home.
                'Location': redirectUri + '#access_token=' + access_token + '&id_token=' + id_token,
                'Cache-Control': 'no-cache',
            },
            body: '',
        };

    } catch (error) {
        console.error('Error exchanging code:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: `Error: Failed to exchange code for tokens.`,
        };
    }
};