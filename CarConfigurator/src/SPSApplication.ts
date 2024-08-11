import { CarConfigurator, SettingUIFlag, UIOptions } from 'carconfigurator-ui';
import { AggregatedStats, SettingFlag, TextParameters, PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.4';
import { LoadingOverlay } from './LoadingOverlay';
import { SPSSignalling } from './SignallingExtension';
import { MessageStats } from './Messages';

// For local testing. Declare a websocket URL that can be imported via a .env file that will override 
// the signalling server URL builder.
declare var WEBSOCKET_URL: string;

declare global {
    interface Window { pixelstreaming: PixelStreaming; }
}

export class SPSApplication extends CarConfigurator {
	private loadingOverlay: LoadingOverlay;
	private signallingExtension: SPSSignalling;

	static Flags = class {
		static sendToServer = "sendStatsToServer"
	}

	constructor(config: UIOptions) {
		super(config);
		this.signallingExtension = new SPSSignalling(this.stream.webSocketController);
		this.signallingExtension.onAuthenticationResponse = this.handleSignallingResponse.bind(this);
		this.signallingExtension.onInstanceStateChanged = this.handleSignallingResponse.bind(this);

		this.enforceSpecialSignallingServerUrl();

		// Add 'Send Stats to Server' checkbox
		const spsSettingsSection = this.configUI.buildSectionWithHeading(this.settingsPanel.settingsContentElement, "Scalable Pixel Streaming");
		const sendStatsToServerSetting = new SettingFlag(
			SPSApplication.Flags.sendToServer,
			"Send stats to server",
			"Send session stats to the server",
			false,
			this.stream.config.useUrlParams
		);

		spsSettingsSection.appendChild(new SettingUIFlag(sendStatsToServerSetting).rootElement);
		this.loadingOverlay = new LoadingOverlay(this.stream.videoElementParent);

		this.stream.addEventListener(
			'statsReceived',
			({ data: { aggregatedStats } }) => {
				if (sendStatsToServerSetting.flag) {
					this.sendStatsToSignallingServer(aggregatedStats);
				}
			}
		);

		// Add stream object to window so we can interact with the interface from browser automation scripts
		window.pixelstreaming = this.stream;
	}

	handleSignallingResponse(signallingResp: string, isError: boolean) {
		this.showErrorOverlay(signallingResp);
	}

	/**
	 * Enforces changes the websocket path to conform to the SPS specification
	 * Can be overridden if the WEBSOCKET_URL var defined in the .env file has been defined
	 */
	enforceSpecialSignallingServerUrl() {

		// SPS needs to build a specific signalling server url based on the application name so K8s can distinguish it
		this.stream.setSignallingUrlBuilder(() => {

			// Check if the WEBSOCKET_URL var in the .env file has been defined
			if (WEBSOCKET_URL !== undefined) {

				// Return the value of the WEBSOCKET_URL var defined in the .env file
				return WEBSOCKET_URL as string;
			}

			// Get the current signalling server URL from the settings
			let signallingUrl = this.stream.config.getTextSettingValue(TextParameters.SignallingServerUrl);

			// Build the signalling URL based on the existing window location, the result should be 'domain.com/signalling/app-name'
			signallingUrl = signallingUrl.endsWith("/") ? signallingUrl + "signalling" + window.location.pathname : signallingUrl + "/signalling" + window.location.pathname;

			// Return the modified signalling server URL
			return signallingUrl
		});
	}

	showLoadingOverlay(signallingResp: string) {
		this.hideCurrentOverlay();
		this.loadingOverlay.show();
		this.loadingOverlay.update(signallingResp);

		// disable rain animation for now as perf is too poor on mobile devices
		// this.loadingOverlay.animate();

		this.currentOverlay = this.loadingOverlay;
	}

	/**
	 * Send Aggregated Stats to the Signaling Server
	 * @param stats - Aggregated Stats
	 */
	sendStatsToSignallingServer(stats: AggregatedStats) {
		const data = new MessageStats(stats);
		this.stream.webSocketController.webSocket.send(data.payload());
	}
}