import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Agent from '@knowlearning/agents'

import 'vuetify/styles'
import '@fortawesome/fontawesome-free/css/all.css'
import { createVuetify } from 'vuetify'
import { aliases, fa } from 'vuetify/iconsets/fa'

import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'fa',
    aliases,
    sets: { fa }
  }
})

window.Agent = Agent

createApp(App)
  .use(vuetify)
  .mount('#app')
