import { installOperationTrace } from './operationTrace'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'

installOperationTrace()
createApp(App).use(createPinia()).mount('#app')
