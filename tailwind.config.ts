import { type Config } from "tailwindcss";

export default {
  content: [
    "{routes,islands,components}/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
        backgroundImage: {
            'main-bg': "url('./main-bg.webp')",
          },
        animation: {
            "scale-in-center": "scale-in-center 0.2s cubic-bezier(0.250, 0.460, 0.450, 0.940)   both ",
            "fade-in": "fade-in 0.2s cubic-bezier(0.390, 0.575, 0.565, 1.000)   both",
            "fadeInScaleIn" : 'fadeInScaleIn 2s ease-in-out'
        },
        keyframes: {
            "scale-in-center": {
                "0%": {
                    transform: "scale(0)",
                    opacity: "1"
                },
                to: {
                    transform: "scale(1)",
                    opacity: "1"
                }
            },
            "fade-in": {
                "0%": {
                    opacity: "0"
                },
                to: {
                    opacity: "1"
                }
            }
        }
    }
}
} satisfies Config;

