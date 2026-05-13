/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cabin', '"Gill Sans"', '"Gill Sans MT"', 'Calibri', 'system-ui', 'sans-serif'],
      },
      colors: {
        hc: {
          teal: {
            DEFAULT: '#005B6E',
            50:  '#E0F0F5',
            100: '#B3D8E2',
            600: '#005B6E',
            700: '#004A58',
            900: '#002F38',
          },
        },
      },
    },
  },
  plugins: [],
}
