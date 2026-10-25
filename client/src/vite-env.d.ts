/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
	readonly VITE_COMPANION_INSTALL_ORIGIN?: string;
	readonly VITE_CLOUD_API_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
