import * as vscode from 'vscode';
import { t } from '../i18n';

export class FeedbackCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		const feedbackOption = await vscode.window.showQuickPick(
			[
				{
					label: t('feedback.bug'),
					description: t('feedback.bugDesc'),
					action: 'bug'
				},
				{
					label: t('feedback.feature'),
					description: t('feedback.featureDesc'),
					action: 'feature'
				},
				{
					label: t('feedback.rate'),
					description: t('feedback.rateDesc'),
					action: 'rate'
				},
				{
					label: t('feedback.review'),
					description: t('feedback.reviewDesc'),
					action: 'review'
				},
				{
					label: t('feedback.discuss'),
					description: t('feedback.discussDesc'),
					action: 'discuss'
				},
				{
					label: t('feedback.contact'),
					description: t('feedback.contactDesc'),
					action: 'contact'
				}
			],
			{
				placeHolder: t('feedback.placeholder'),
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
					label: t('feedback.bugTemplate'),
					description: t('feedback.bugTemplateDesc'),
					action: 'template'
				},
				{
					label: t('feedback.bugQuick'),
					description: t('feedback.bugQuickDesc'),
					action: 'quick'
				},
				{
					label: t('feedback.bugExisting'),
					description: t('feedback.bugExistingDesc'),
					action: 'existing'
				}
			],
			{ placeHolder: t('feedback.bugMethodPlaceholder') }
		);

		switch (reportBug?.action) {
			case 'template':
				await vscode.env.openExternal(
					vscode.Uri.parse('https://github.com/kareem2099/dotenvy/issues/new?template=bug-report.yml')
				);
				break;
			case 'quick':
				const bugDescription = await vscode.window.showInputBox({
					prompt: t('feedback.bugPrompt'),
					placeHolder: t('feedback.bugPlaceholder')
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
			prompt: t('feedback.featurePrompt'),
			placeHolder: t('feedback.featurePlaceholder')
		});

		if (featureSuggestion) {
			const url = `https://github.com/kareem2099/dotenvy/issues/new?title=Feature+Request:+${encodeURIComponent(featureSuggestion.substring(0, 50))}&labels=enhancement`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}
	}

	private async rateExtension(): Promise<void> {
		const rateNow = t('feedback.rateNow');
		const action = await vscode.window.showInformationMessage(
			t('feedback.rateQuestion'),
			rateNow,
			t('feedback.later')
		);

		if (action === rateNow) {
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
					label: t('feedback.email'),
					description: t('feedback.emailDesc'),
					action: 'email'
				},
				{
					label: t('feedback.github'),
					description: t('feedback.githubDesc'),
					action: 'github'
				}
			],
			{ placeHolder: t('feedback.contactPlaceholder') }
		);

		switch (contactMethod?.action) {
			case 'email':
				// Replace with actual email
				await vscode.window.showInformationMessage(
					t('feedback.emailAddress', { email: 'support@kareemdev.com' })
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
