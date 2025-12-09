// netlify/functions/auth-callback.js
const axios = require('axios');
const https = require('https'); 

// Crea un agente que desactiva la verificación SSL/TLS estricta (Diagnóstico Final)
const agent = new https.Agent({
    rejectUnauthorized: false
});

// Lee las variables de entorno de Netlify
const { 
    AUTH0_CLIENT_ID, 
    AUTH0_CLIENT_SECRET, 
    AUTH0_DOMAIN 
} = process.env;

exports.handler = async (event, context) => {
    // 1. Obtener el código de autorización de la URL de retorno
    const { code } = event.queryStringParameters;
    
    if (!code) {
        return {
            statusCode: 400,
            body: 'Error: No authorization code provided.'
        };
    }

    // La URL debe coincidir exactamente con la configurada en Auth0 (la raíz)
    const redirectUri = 'https://azor-calidad.netlify.app/'; 

    try {
        // 2. Intercambiar el código por los tokens (¡Aquí se usa el Client Secret de Netlify!)
        const tokenResponse = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
            grant_type: 'authorization_code',
            client_id: AUTH0_CLIENT_ID,
            client_secret: AUTH0_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
        }, {
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: agent, // Usar el agente de diagnóstico
        });

        const { id_token, access_token } = tokenResponse.data;

        // 3. Redireccionar al cliente, estableciendo una cookie de sesión.
        const finalRedirect = 'https://azor-calidad.netlify.app/'; 

        return {
            statusCode: 302,
            headers: {
                // Set-Cookie (sin Secure, para máxima compatibilidad)
                'Set-Cookie': `nf_jwt=${id_token}; Path=/; Max-Age=3600; HttpOnly`,
                'Location': finalRedirect,
                'Cache-Control': 'no-cache',
            },
            body: '',
        };

    } catch (error) {
        // Reporta el error completo de la respuesta de Auth0
        console.error('Error exchanging code:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: `Error: Failed to exchange code for tokens.`,
        };
    }
};