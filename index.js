var inquirer = require("inquirer");
var program = require('commander');
var accountHelper = require('./helpers/account.js');
var blockHelper = require('./helpers/block.js');
var dappHelper = require('./helpers/dapp.js');
var gift = require('gift');
var fs = require('fs');
var path = require('path');
var rmdir = require('rmdir');
var cryptoLib = require('./lib/crypto.js');
var npm = require('npm');
var request = require('request');

var sdk = "git@github.com:LiskHQ/lisk-dapps-sdk.git";

program.version('1.1.1');

program
	.command("dapps")
	.description("manage your dapps")
	.option("-a, --add", "add new dapp")
	.option("-c, --change", "change dapp genesis block")
	.option("-d, --deposit", "deposit funds to dapp")
	.option("-w, --withdrawal", "withdraw funds from dapp")
	.action(function (options) {
		if (options.add) {
			inquirer.prompt([
				{
					type: "confirm",
					name: "confirmed",
					message: "Existing blockchain.db file will be replaced, are you sure?",
					default: false
				}
			], function (result) {
				if (result.confirmed) {
					inquirer.prompt([
						{
							type: "password",
							name: "secret",
							message: "Enter secret of your testnet account",
							validate: function (value) {
								var done = this.async();

								if (value.length == 0) {
									done("Secret is too short, minimum is 1 character");
									return;
								}

								if (value.length > 100) {
									done("Secret is too long, maximum is 100 characters");
									return;
								}

								done(true);
							}
						}
					], function (result) {
						var account = accountHelper.account(result.secret);

						inquirer.prompt([
							{
								type: "confirm",
								name: "confirmed",
								message: "Overwrite the existing genesis block?",
								default: true
							}
						], function (result) {
							var genesisBlock = null;
							var newGenesisBlock = result.confirmed;

							if (!newGenesisBlock) {
								try {
									var genesisBlock = JSON.parse(fs.readFileSync(path.join('.', 'genesisBlock.json'), 'utf8'));
								} catch (e) {
									console.log("Can't read genesisBlock.js: ", e.toString());
									return;
								}
							}

							inquirer.prompt([
								{
									type: "input",
									name: "name",
									message: "Enter DApp name",
									required: true,
									validate: function (value) {
										var done = this.async();

										if (value.length == 0) {
											done("DApp name is too short, minimum is 1 character");
											return;
										}

										if (value.length > 32) {
											done("DApp name is too long, maximum is 32 characters");
											return;
										}

										return done(true)
									}
								},
								{
									type: "input",
									name: "description",
									message: "Enter DApp description",
									validate: function (value) {
										var done = this.async();

										if (value.length > 160) {
											done("DApp description is too long, maximum is 160 characters");
											return;
										}

										return done(true);
									}
								},
								{
									type: "input",
									name: "git",
									message: "Github repository",
									required: true,
									validate: function (value) {
										var done = this.async();

										if (!(/^git\@github\.com\:.+\.git$/.test(value))) {
											done("Incorrect github repository link");
											return;
										}

										return done(true);
									}
								}
							], function (result) {
								console.log("Generating unique genesis block...");

								var block, dapp, delegates;

								if (newGenesisBlock) {
									var r = blockHelper.new(account,
										{
											name: result.name,
											description: result.description,
											git: result.git,
											type: 0,
											category: 0
										}
									);

									block = r.block;
									dapp = r.dapp;
									delegates = r.delegates;
								} else {
									try {
										var r = blockHelper.from(genesisBlock, account,
											{
												name: result.name,
												description: result.description,
												git: result.git,
												type: 0,
												category: 0
											}
										);
									} catch (e) {
										return console.log(e);
									}

									block = r.block;
									dapp = r.dapp;
								}
									inquirer.prompt([
										{
											type: "input",
											name: "publicKeys",
											message: "Enter public keys of dapp forgers - hex array, use ',' for separator",
											default: account.keypair.publicKey,
											validate: function (value) {
												var done = this.async();

												var publicKeys = value.split(',');

												if (publicKeys.length == 0) {
													done('DApp requires at least 1 public key');
													return;
												}

												for (var i in publicKeys) {
													try {
														var b = new Buffer(publicKeys[i], 'hex');
														if (b.length != 32) {
															done('Incorrect public key: ' + publicKeys[i]);
															return;
														}
													} catch (e) {
														done('Incorrect hex for public key: ' + publicKeys[i]);
														return;
													}
												}

												done(true);
											}
										}
									], function (result) {
										console.log("Creating DApp genesis block");
										var dappBlock = dappHelper.new(account, block, result.publicKeys.split(','));

										console.log("Fetching Lisk Dapps SDK");
										var dappsPath = path.join('.', 'dapps');
										fs.exists(dappsPath, function (exists) {
											if (!exists) {
												fs.mkdirSync(dappsPath);
											}

										var dappPath = path.join(dappsPath, dapp.id);
										gift.clone(sdk, dappPath, function (err, repo) {
											if (err) {
												return console.log(err.toString());
											}

											rmdir(path.join(dappPath, ".git"), function (err) {
												if (err) {
													return console.log(err.toString());
												}

												console.log("Connecting local repository with origin");
												gift.init(dappPath, function (err, repo) {
													if (err) {
														return console.log(err.toString());
													}

													repo.remote_add('origin', dapp.asset.dapp.git, function (err, repo) {
														if (err) {
															return console.log(err.toString());
														}

														var bcFile = path.join('.', 'blockchain.db');

														var exists = fs.existsSync(bcFile);
														if (exists) {
															fs.unlinkSync(bcFile);
														}

														var packageJson = path.join(dappPath, "package.json");
														var config = null;

														try {
															config = JSON.parse(fs.readFileSync(packageJson));
														} catch (e) {
															return setImmediate(cb, "Incorrect package.json file for " + dApp.transactionId + " DApp");
														}

														npm.load(config, function (err) {
															npm.root = path.join(dappPath, "node_modules");
															npm.prefix = dappPath;

															npm.commands.install(function (err, data) {
																if (err) {
																	return console.log(err);
																} else {
																	console.log("Saving genesis block");
																	var genesisBlockJson = JSON.stringify(block, null, 4);

																	try {
																		fs.writeFileSync(path.join('.', 'genesisBlock.json'), genesisBlockJson, "utf8");
																	} catch (e) {
																		return console.log(err);
																	}

																	var dappGenesisBlockJson = JSON.stringify(dappBlock, null, 4);

																	try {
																		fs.writeFileSync(path.join(dappPath, 'genesis.json'), dappGenesisBlockJson, "utf8");
																	} catch (e) {
																		return console.log(err);
																	}

																	console.log("Updating config");

																	try {
																		var config = JSON.parse(fs.readFileSync(path.join('.', 'config.json'), 'utf8'));
																	} catch (e) {
																		return console.log(e);
																	}

																	if (newGenesisBlock) {
																		config.forging = config.forging || {};
																		config.forging.secret = delegates.map(function (d) {
																			return d.secret;
																		});
																	}

																	inquirer.prompt([
																		{
																			type: "confirm",
																			name: "confirmed",
																			message: "Add dapp to autolaunch?"
																		}
																	], function (result) {
																		if (result.confirmed) {
																			config.dapp = config.dapp || {};
																			config.dapp.autoexec = config.dapp.autoexec || [];
																			config.dapp.autoexec.push({
																				params: [
																					account.secret,
																					"modules.full.json"
																				],
																				dappid: dapp.id
																			})
																		}

																		fs.writeFile(path.join('.', 'config.json'), JSON.stringify(config, null, 2), function (err) {
																			if (err) {
																				console.log(err);
																			} else {
																				console.log("Done (DApp id is " + dapp.id + ")");
																			}
																		});
																	});
																}
															});
														});
													});
												});
											});
										});
									});

								});
							});
						});
					});
				}
			});
		} else if (options.change) {
			inquirer.prompt([
				{
					type: "confirm",
					name: "confirmed",
					message: "Existing blockchain.db file will be replaced, are you sure?",
					default: false
				}
			], function (result) {
				if (result.confirmed) {
					inquirer.prompt([
						{
							type: "password",
							name: "secret",
							message: "Enter secret of your testnet account",
							validate: function (value) {
								var done = this.async();

								if (value.length == 0) {
									done("Secret is too short, minimum is 1 character");
									return;
								}

								if (value.length > 100) {
									done("Secret is too long, maximum is 100 characters");
									return;
								}

								done(true);
							}
						}
					], function (result) {
						var account = accountHelper.account(result.secret);

						inquirer.prompt([
							{
								type: "input",
								name: "dappId",
								message: "Enter DApp id (folder name of dapp)",
								required: true
							},
						], function (result) {
							var dappId = result.dappId,
								publicKeys = [];

							var dappPath = path.join('.', 'dapps', dappId);
							var dappGenesis = require(path.join(dappPath, 'genesis.json'));

							inquirer.prompt([
								{
									type: "confirm",
									name: "confirmed",
									message: "Continue with exists forgers public keys",
									required: true,
								}], function (result) {
								if (result.confirmed) {
									publicKeys = dappGenesis.delegates;
								}

								inquirer.prompt([
									{
										type: "input",
										name: "publicKeys",
										message: "Enter public keys of dapp forgers - hex array, use ',' for separator",
										default: account.keypair.publicKey,
										validate: function (value) {
											var done = this.async();

											var publicKeys = value.split(',');

											if (publicKeys.length == 0) {
												done('DApp requires at least 1 public key');
												return;
											}

											for (var i in publicKeys) {
												try {
													var b = new Buffer(publicKeys[i], 'hex');
													if (b.length != 32) {
														done('Incorrect public key: ' + publicKeys[i]);
														return;
													}
												} catch (e) {
													done('Incorrect hex for public key: ' + publicKeys[i]);
													return;
												}
											}

											done(true);
										}
									}
								], function (result) {
									publicKeys = publicKeys.concat(result.publicKeys.split(','));

									console.log("Creating DApp genesis block");

									var bcFile = path.join('.', 'blockchain.db');

									var exists = fs.existsSync(bcFile);
									if (exists) {
										fs.unlinkSync(bcFile);
									}

									var dappBlock = dappHelper.new(account, block, result.publicKeys.split(','));

									var dappGenesisBlockJson = JSON.stringify(dappBlock, null, 4);

									try {
										fs.writeFileSync(path.join(dappPath, 'genesis.json'), dappGenesisBlockJson, "utf8");
									} catch (e) {
										return console.log(err);
									}

									console.log("Done");
								});
							});
						});
					});

				}
			});
		} else if (options.deposit) {
			inquirer.prompt([
				{
					type: "password",
					name: "secret",
					message: "Enter secret",
					validate: function (value) {
						return value.length > 0 && value.length < 100;
					},
					required: true
				},
				{
					type: "input",
					name: "amount",
					message: "Enter amount",
					validate: function (value) {
						return !isNaN(parseInt(value));
					},
					required: true
				},
				{
					type: "input",
					name: "dappId",
					message: "DApp Id",
					required: true
				},
				{
					type: "input",
					name: "secondSecret",
					message: "Enter secondary secret (if defined)",
					validate: function (value) {
						return value.length < 100;
					},
					required: false
				}
			], function (result) {
				var body = {
					secret: result.secret,
					dappId: result.dappId,
					amount: parseInt(result.amount)
				};

				if (result.secondSecret && result.secondSecret.length > 0) {
					body.secondSecret = result.secondSecret;
				}

				inquirer.prompt([
					{
						type: "input",
						name: "host",
						message: "Host and port",
						default: "localhost:7040",
						required: true
					}
				], function (result) {
					request({
						url: "http://" + result.host + "/api/dapps/transaction",
						method: "put",
						json: true,
						body: body
					}, function (err, resp, body) {
						console.log(err, body);
						if (err) {
							return console.log(err.toString());
						}

						if (body.success) {
							console.log(body.transactionId);
							return;
						} else {
							return console.log(body.error);
						}
					});
				});
			});
		} else if (options.withdrawal) {
			inquirer.prompt([
				{
					type: "password",
					name: "secret",
					message: "Enter secret",
					validate: function (value) {
						return value.length > 0 && value.length < 100;
					},
					required: true
				},
				{
					type: "input",
					name: "amount",
					message: "Amount",
					validate: function (value) {
						return !isNaN(parseInt(value));
					},
					required: true
				},
				{
					type: "input",
					name: "dappId",
					message: "Enter DApp id",
					validate: function (value) {
						var isAddress = /^[0-9]$/g;
						return isAddress.test(value);
					},
					required: true
				}], function (result) {

				var body = {
					secret: result.secret,
					amount: result.amount
				};

				request({
					url: "http://localhost:7040/api/dapps/" + result.dappId + "/api/withdrawal",
					method: "post",
					json: true,
					body: body
				}, function (err, resp, body) {
					if (err) {
						return console.log(err.toString());
					}

					if (body.success) {
						console.log(body.response.transactionId);
					} else {
						return console.log(body.error);
					}
				});
			});
		} else {
			console.log("'node dapps -h' to get help");
		}
	});

program
	.command('contract')
	.description('contract operations')
	.option('-a, --add', "add new contract")
	.option('-d, --delete', "delete contract")
	.action(function (options) {
		var contractsPath = path.join('.', 'modules', 'contracts');
		fs.exists(contractsPath, function (exist) {
			if (exist) {
				if (options.add) {
					fs.readdir(contractsPath, function (err, filenames) {
						if (err) {
							return console.log(err);
						}

						inquirer.prompt([
							{
								type: "input",
								name: "filename",
								message: "Contract file name (without .js)"
							}
						], function (result) {
							var name = result.filename,
								type = filenames.length + 1,
								filename = result.filename + ".js";

							fs.readFile(path.join(__dirname, "contract-example.js"), "utf8", function (err, exampleContract) {
								if (err) {
									return console.log(err);
								}

								exampleContract = exampleContract.replace(/ExampleContract/g, name);
								exampleContract = exampleContract.replace("//self.type = null;", "self.type = " + type);

								fs.writeFile(path.join(contractsPath, filename), exampleContract, "utf8", function (err) {
									if (err) {
										return console.log(err);
									} else {
										console.log("New contract created: " + ("./contracts/" + filename));
										console.log("Updating contracts list");

										fs.readFile(path.join('.', 'modules.full.json'), 'utf8', function (err, text) {
											if (err) {
												return console.log(err);
											}

											try {
												var modules = JSON.parse(text);
											} catch (e) {
												return console.log(e);
											}

											var contractName = "contracts/" + name;
											var dappPathConfig = "./" + path.join(contractsPath, filename);

											modules[contractName] = dappPathConfig;
											modules = JSON.stringify(modules, false, 4);

											fs.writeFile(path.join('.', 'modules.full.json'), modules, 'utf8', function (err) {
												if (err) {
													return console.log(err);
												}

												console.log("Done");
											});
										});
									}
								});
							});
						});
					});
				} else if (options.delete) {
					inquirer.prompt([
						{
							type: "input",
							name: "filename",
							message: "Contract file name (without .js)"
						}
					], function (result) {
						var name = result.filename,
							type = filenames.length + 1,
							filename = result.filename + ".js";

						var contractPath = path.join(contractsPath, filename);
						fs.exists(contractPath, function (exists) {
							if (exists) {
								fs.unlink(contractPath, function (err) {
									if (err) {
										return console.log(err);
									}

									console.log("Contract removed");
									console.log("Updating contracts list");

									fs.readFile(path.join('.', 'modules.full.json'), 'utf8', function (err, text) {
										if (err) {
											return console.log(err);
										}

										try {
											var modules = JSON.parse(text);
										} catch (e) {
											return console.log(e);
										}

										var name = "contracts/" + name;

										delete modules[name];
										modules = JSON.stringify(modules, false, 4);

										fs.writeFile(path.join('.', 'modules.full.json'), modules, 'utf8', function (err) {
											if (err) {
												return console.log(err);
											}

											console.log("Done");
										});
									});
								});
							} else {
								return console.log("Contract not found: " + contractPath);
							}
						});
					});
				} else {

				}
			} else {
				return console.log('./modules/contracts path not found, please change directory to your dapp folder');
			}
		});
	});

program
	.command('crypto')
	.description("crypto operations")
	.option('-p, --pubkey', "generate public key from secret")
	.option('-g, --generate', "generate random accounts")
	.action(function (options) {
		if (options.pubkey) {
			inquirer.prompt([
				{
					type: "password",
					name: "secret",
					message: "Enter secret of your testnet account",
					validate: function (value) {
						var done = this.async();

						if (value.length == 0) {
							done("Secret is too short, minimum is 1 character");
							return;
						}

						if (value.length > 100) {
							done("Secret is too long, maximum is 100 characters");
							return;
						}

						done(true);
					}
				}
			], function (result) {
				var account = accountHelper.account(result.secret);
				console.log("Public key: " + account.keypair.publicKey);
			});
		} else if (options.generate) {
			inquirer.prompt([
				{
					type: "input",
					name: "amount",
					message: "Enter number of accounts to generate",
					validate: function (value) {
						var num = parseInt(value);
						return !isNaN(num);
					}
				}
			], function (result) {
				var n = parseInt(result.amount),
					accounts = [];

				for (var i = 0; i < n; i++) {
					var a = accountHelper.account(cryptoLib.randomString(32));
					accounts.push({
						address: a.address,
						secret: a.secret,
						publicKey: a.keypair.publicKey
					});
				}

				console.log(accounts);
				console.log("Done");
			});
		} else {
			console.log("'node crypto -h' to get help");
		}
	});

if (!process.argv.slice(2).length) {
	program.outputHelp();
}

program.parse(process.argv);
