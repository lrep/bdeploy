describe('Software Repository Tests', () => {
  var repoName = 'Test-Repo-' + new Date().getTime();

  beforeEach(() => {
    cy.login();
  });

  it('Create Software Repository', () => {
    cy.visit('/#/softwarerepo/browser');
    cy.waitUntilContentLoaded();

    cy.contains('button', 'add').click();

    cy.get('input[placeholder^="Software Repository name"]').type(repoName);
    cy.get('input[placeholder=Description]').type('Automated Test Repo ' + repoName);

    cy.contains('button', 'SAVE').click();
    cy.waitUntilContentLoaded();

    cy.contains('mat-card', repoName).should('exist');
  });

  it('Delete Software Repository', () => {
    cy.visit('/#/softwarerepo/browser');
    cy.waitUntilContentLoaded();

    cy.contains('mat-card', repoName)
      .should('exist')
      .clickContextMenuDialog('Delete');
    cy.contains('mat-dialog-container', 'Delete Software Repository: ' + repoName)
      .should('exist')
      .within(dialog => {
        cy.contains('button', 'OK').click();
      });

    cy.contains('mat-card', repoName).should('not.exist');
  });
});
