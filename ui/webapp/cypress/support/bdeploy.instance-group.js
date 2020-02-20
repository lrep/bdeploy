/**
 * Command: createInstanceGroup
 */
Cypress.Commands.add('createInstanceGroup', function(name, mode = 'STANDALONE') {
  cy.visitBDeploy('/', mode);
  cy.waitUntilContentLoaded();

  cy.contains('button', 'add').click();

  cy.contains('button', 'SAVE').should('exist').and('be.disabled');
  cy.get('input[placeholder^="Instance group ID"]').should('exist').click();
  cy.get('input[placeholder^="Instance group ID"]').should('exist').and('have.focus').type(name);
  cy.get('input[placeholder=Description]').type(name);

  cy.fixture('bdeploy.png').then(fileContent => {
    cy.get('input[type=file]').upload({ fileContent: fileContent, fileName: 'bdeploy.png', mimeType: 'image/png' });
  });

  cy.get('.logo-img').should('exist');

  cy.contains('button', 'SAVE').click();
  cy.waitUntilContentLoaded();

  cy.get('[data-cy=group-' + name + ']').should('exist');
})

/**
 * Command: deleteInstanceGroup
 */
Cypress.Commands.add('deleteInstanceGroup', function(name, mode = 'STANDALONE') {
  cy.visitBDeploy('/', mode);

  cy.get('[data-cy=group-' + name + ']')
    .should('exist')
    .clickContextMenuItem('Delete');
  cy.contains('mat-dialog-container', 'Delete Instance Group: ' + name)
    .should('exist')
    .within(dialog => {
      cy.contains('Deleting an instance group cannot be undone').should('exist');
      cy.contains('button', 'Delete').should('be.disabled');
      cy.get('input[placeholder="Instance Group ID"]')
        .clear()
        .type(name);
      cy.contains('button', 'Delete')
        .should('be.enabled')
        .click();
    });

  cy.get('[data-cy=group-' + name + ']').should('not.exist');
})

/**
 * Command: uploadProductIntoGroup
 */
Cypress.Commands.add('uploadProductIntoGroup', function(groupName,fileName, mode = 'STANDALONE') {
  cy.visitBDeploy('/', mode);
  cy.waitUntilContentLoaded();

  cy.get('[data-cy=group-' + groupName + ']').first().should('exist').click();
  cy.waitUntilContentLoaded();

  cy.get('button[mattooltip="Manage Products..."]').should('be.visible').and('be.enabled').click();
  cy.contains('button', 'cloud_upload').should('be.visible').and('be.enabled').click();

  cy.get('mat-dialog-container').within(() => {
    cy.fixture(fileName).then(zip => {
      cy.get('input[type=file]').upload({
        fileName: fileName,
        fileContent: zip,
         mimeType: 'application/zip',
      });
    });

    cy.contains('button', 'Upload').should('be.enabled').click();
    cy.get('td:contains("Upload successful")').should('have.length', 1);

    cy.contains('button', 'Close').should('be.visible').and('be.enabled').click();
  });
})

 /**
 * Command: verifyProductVersion
 */
Cypress.Commands.add('verifyProductVersion', function(groupName, productName, productId, productVersion, mode = 'STANDALONE') {
  cy.visitBDeploy('/', mode);
  cy.waitUntilContentLoaded();

  cy.get('[data-cy=group-' + groupName + ']').first().should('exist').click();
  cy.waitUntilContentLoaded();

  cy.get('button[mattooltip="Manage Products..."]').should('be.visible').and('be.enabled').click();
  cy.contains('app-product-card', productName).should('exist').click();

  cy.get('app-product-list').contains(productVersion).should('exist');
  cy.contains('app-product-list', productVersion).within(() => {
    cy.contains('button', 'info').should('be.visible').click();
  });

  cy.get('mat-card.info').within(() => {
    cy.contains('mat-chip', 'X-Product').contains(productId).should('exist');
  });
})

Cypress.Commands.add('attachManaged', function(groupName) {
  cy.visitBDeploy('/', 'MANAGED');

  cy.contains('button', 'link').should('exist').and('be.enabled').click();

  cy.contains('button', 'Next').should('exist').and('be.enabled').click();
  cy.contains('button', 'Continue Manually').should('exist').and('be.enabled').click();

  cy.contains('button', 'Download').should('exist').and('be.enabled').downloadBlobFile('managed-ident.json');

  cy.visitBDeploy('/', 'CENTRAL');
  cy.get('[data-cy=group-' + groupName + ']')
    .should('exist')
    .clickContextMenuItem('Managed Servers...');

  cy.waitUntilContentLoaded();

  cy.contains('button', 'add').should('exist').and('be.enabled').click();
  cy.contains('button', 'Next').should('exist').and('be.enabled').click();

  cy.contains('mat-step-header', 'Attach Managed Server').parent().within(e => {
    cy.fixture('managed-ident.json').then(json => {
      cy.get('input[data-cy="managed-ident"]').upload({
        fileName: 'managed-ident.json',
        fileContent: JSON.stringify(json),
        mimeType: 'application/json',
      });
    });

    cy.contains('Successfully read information for').should('exist').and('be.visible');
    cy.contains('button', 'Next').should('exist').and('be.visible').and('be.enabled').click();
  })

  cy.contains('mat-step-header', 'Additional Information').parent().within(e => {
    cy.get('input[placeholder=Description]').should('exist').and('be.visible').and('be.empty').type('Test Local Server');
    cy.contains('button', 'Next').should('exist').and('be.enabled').scrollIntoView().click();
  });

  // magic happens here :)

  cy.contains('mat-step-header', 'Done').parent().within(e => {
    cy.contains('button', 'Done').should('exist').and('be.enabled').scrollIntoView().click();
  });

  // we're on the managed servers page again now. verify server exists and can be sync'd.
  cy.contains('mat-expansion-panel', 'Test Local Server').should('exist').and('be.visible').within(e => {
    cy.contains('button', 'Synchronize').should('exist').and('be.enabled').click();

    // don't use waitUntilContentLoaded as it does not work in within blocks.
    cy.get('mat-spinner').should('not.exist');

    cy.contains('span', 'Last sync').should('contain.text', new Date().getFullYear());
    cy.contains('td', 'flight_takeoff').should('exist'); // the aeroplane
  });
})
