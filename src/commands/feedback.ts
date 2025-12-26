import * as vscode from 'vscode';

export class FeedbackCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		const feedbackOption = await vscode.window.showQuickPick(
			[
				{
					label: '🐛 Report Bug',
					description: 'Found an issue or bug',
					action: 'bug'
				},
				{
					label: '💡 Feature Request',
					description: 'Suggest a new feature',
					action: 'feature'
				},
				{
					label: '⭐ Rate Extension',
					description: 'Rate on Visual Studio Marketplace',
					action: 'rate'
				},
				{
					label: '📝 Write Review',
					description: 'Leave a review on Marketplace',
					action: 'review'
				},
				{
					label: '💬 Discussions',
					description: 'Share ideas and feedback',
					action: 'discuss'
				},
				{
					label: '📧 Contact Developer',
					description: 'Send direct message',
					action: 'contact'
				}
			],
			{
				placeHolder: 'How can we help you?',
				matchOnDescription: true
			}
		);

		if (!feedbackOption) return;

		switch (feedbackOption.action) {
			case 'bug':
				await this.reportBug();
				break;
			case 'feature':
				await this.suggestFeature();
				break;
			case 'rate':
				await this.rateExtension();
				break;
			case 'review':
				await this.writeReview();
				break;
			case 'discuss':
				await this.openDiscussions();
				break;
			case 'contact':
				await this.contactDeveloper();
				break;
		}
	}

	private async reportBug(): Promise<void> {
		const reportBug = await vscode.window.showQuickPick(
			[
				{
					label: '📋 Use Bug Report Template',
					description: 'Structured bug report (recommended)',
					action: 'template'
				},
				{
					label: '🐛 Quick Bug Report',
					description: 'Simple bug description',
					action: 'quick'
				},
				{
					label: '🔍 Check Known Issues',
					description: 'Search existing bug reports',
					action: 'existing'
				}
			],
			{ placeHolder: 'Choose bug reporting method' }
		);

		switch (reportBug?.action) {
			case 'template':
				await vscode.env.openExternal(
					vscode.Uri.parse('https://github.com/kareem2099/dotenvy/issues/new?template=bug-report.yml')
				);
				break;
			case 'quick':
				const bugDescription = await vscode.window.showInputBox({
					prompt: 'Describe the bug briefly',
					placeHolder: 'What happened and what you expected...'
				});
				if (bugDescription) {
					const url = `https://github.com/kareem2099/dotenvy/issues/new?title=Bug:+${encodeURIComponent(bugDescription.substring(0, 50))}`;
					await vscode.env.openExternal(vscode.Uri.parse(url));
				}
				break;
			case 'existing':
				await vscode.env.openExternal(
					vscode.Uri.parse('https://github.com/kareem2099/dotenvy/issues')
				);
				break;
		}
	}

	private async suggestFeature(): Promise<void> {
		const featureSuggestion = await vscode.window.showInputBox({
			prompt: 'Describe your feature request',
			placeHolder: 'What new feature would you like to see...'
		});

		if (featureSuggestion) {
			const url = `https://github.com/kareem2099/dotenvy/issues/new?title=Feature+Request:+${encodeURIComponent(featureSuggestion.substring(0, 50))}&labels=enhancement`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}
	}

	private async rateExtension(): Promise<void> {
		const action = await vscode.window.showInformationMessage(
			'Would you like to rate dotenvy on the Visual Studio Marketplace?',
			'Rate Now',
			'Later'
		);

		if (action === 'Rate Now') {
			await vscode.env.openExternal(
				vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy#review-details')
			);
		}
	}

	private async writeReview(): Promise<void> {
		await vscode.env.openExternal(
			vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy#review-details')
		);
	}

	private async openDiscussions(): Promise<void> {
		await vscode.env.openExternal(
			vscode.Uri.parse('https://github.com/kareem2099/dotenvy/discussions')
		);
	}

	private async contactDeveloper(): Promise<void> {
		// You can replace this with your preferred contact method
		const contactMethod = await vscode.window.showQuickPick(
			[
				{
					label: '📧 Email',
					description: 'Send email to developer',
					action: 'email'
				},
				{
					label: '🐛 GitHub Issue',
					description: 'Use GitHub for support',
					action: 'github'
				}
			],
			{ placeHolder: 'Choose contact method' }
		);

		switch (contactMethod?.action) {
			case 'email':
				// Replace with actual email
				await vscode.window.showInformationMessage(
					'You can contact the developer at: support@kareemdev.com'
				);
				break;
			case 'github':
				await vscode.env.openExternal(
					vscode.Uri.parse('https://github.com/kareem2099/dotenvy/issues/new?title=Support+Request')
				);
				break;
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}
